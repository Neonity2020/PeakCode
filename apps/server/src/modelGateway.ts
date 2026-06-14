import type http from "node:http";

import { getRuntimeDeepSeekApiKey } from "./runtimeSecrets";

const GATEWAY_PREFIXES = ["/gateway/openai/v1", "/v1"] as const;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

const DEEPSEEK_MODELS = [
  {
    id: "deepseek-v4-flash",
    object: "model",
    created: 0,
    owned_by: "deepseek",
  },
  {
    id: "deepseek-v4-pro",
    object: "model",
    created: 0,
    owned_by: "deepseek",
  },
] as const;

type GatewayRoute =
  | { kind: "models" }
  | { kind: "chatCompletions" }
  | { kind: "responses" };

export function matchModelGatewayRoute(url: URL): GatewayRoute | null {
  for (const prefix of GATEWAY_PREFIXES) {
    if (url.pathname === `${prefix}/models`) return { kind: "models" };
    if (url.pathname === `${prefix}/chat/completions`) return { kind: "chatCompletions" };
    if (url.pathname === `${prefix}/responses`) return { kind: "responses" };
  }
  return null;
}

export function isModelGatewayPath(url: URL): boolean {
  return matchModelGatewayRoute(url) !== null;
}

export function modelGatewayModelsResponse() {
  return {
    object: "list",
    data: DEEPSEEK_MODELS,
  };
}

export function isModelGatewayAuthorized(headers: http.IncomingHttpHeaders): boolean {
  const gatewayKey = process.env.PEAKCODE_GATEWAY_API_KEY?.trim();
  if (!gatewayKey) return true;

  const authorization = firstHeader(headers.authorization);
  if (authorization?.replace(/^Bearer\s+/i, "").trim() === gatewayKey) return true;

  const apiKey = firstHeader(headers["x-api-key"]);
  return apiKey?.trim() === gatewayKey;
}

export function modelGatewayAuthError() {
  return {
    error: {
      message: "Missing or invalid gateway API key.",
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  };
}

export function modelGatewayUpstreamKeyError() {
  return {
    error: {
      message: "DEEPSEEK_API_KEY is not configured for the local model gateway.",
      type: "invalid_request_error",
      code: "missing_upstream_api_key",
    },
  };
}

export async function readNodeRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function serveNodeModelGatewayRoute(input: {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly url: URL;
}): Promise<boolean> {
  const route = matchModelGatewayRoute(input.url);
  if (!route) return false;

  if (route.kind === "models") {
    writeJson(input.res, 200, modelGatewayModelsResponse());
    return true;
  }

  if (input.req.method !== "POST") {
    writeJson(input.res, 405, {
      error: { message: "Method Not Allowed", type: "invalid_request_error" },
    });
    return true;
  }

  if (!isModelGatewayAuthorized(input.req.headers)) {
    writeJson(input.res, 401, modelGatewayAuthError());
    return true;
  }

  const apiKey = getDeepSeekApiKey();
  if (!apiKey) {
    writeJson(input.res, 503, modelGatewayUpstreamKeyError());
    return true;
  }

  const rawBody = await readNodeRequestBody(input.req);
  const body = parseGatewayJsonBody(rawBody);
  if (!body) {
    writeJson(input.res, 400, {
      error: { message: "Invalid JSON request body.", type: "invalid_request_error" },
    });
    return true;
  }

  const upstreamBody =
    route.kind === "responses" ? responseRequestToChatCompletionRequest(body) : body;
  const upstreamResponse = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(upstreamBody),
  });

  if (isStreamingResponse(upstreamBody, upstreamResponse)) {
    if (route.kind === "responses" && upstreamResponse.ok && upstreamResponse.body) {
      await pipeChatCompletionStreamAsResponsesStream(input.res, upstreamResponse, upstreamBody);
      return true;
    }
    await pipeUpstreamStream(input.res, upstreamResponse);
    return true;
  }

  const upstreamText = await upstreamResponse.text();
  if (route.kind === "responses" && upstreamResponse.ok) {
    writeJson(
      input.res,
      upstreamResponse.status,
      chatCompletionResponseToResponsesResponse(parseGatewayJsonBody(upstreamText)),
    );
    return true;
  }

  writeTextResponse(input.res, upstreamResponse, upstreamText);
  return true;
}

export async function serveEffectModelGatewayRoute(input: {
  readonly route: GatewayRoute;
  readonly method: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly bodyText: string;
}): Promise<{ readonly status: number; readonly headers: Record<string, string>; readonly body: string }> {
  if (input.route.kind === "models") {
    return jsonResult(200, modelGatewayModelsResponse());
  }

  if (input.method !== "POST") {
    return jsonResult(405, {
      error: { message: "Method Not Allowed", type: "invalid_request_error" },
    });
  }

  if (!isModelGatewayAuthorized(input.headers)) {
    return jsonResult(401, modelGatewayAuthError());
  }

  const apiKey = getDeepSeekApiKey();
  if (!apiKey) {
    return jsonResult(503, modelGatewayUpstreamKeyError());
  }

  const body = parseGatewayJsonBody(input.bodyText);
  if (!body) {
    return jsonResult(400, {
      error: { message: "Invalid JSON request body.", type: "invalid_request_error" },
    });
  }

  const upstreamBody =
    input.route.kind === "responses" ? responseRequestToChatCompletionRequest(body) : body;
  const upstreamResponse = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(upstreamBody),
  });
  if (isStreamingResponse(upstreamBody, upstreamResponse)) {
    if (input.route.kind === "responses" && upstreamResponse.ok && upstreamResponse.body) {
      return {
        status: upstreamResponse.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": upstreamResponse.headers.get("cache-control") ?? "no-cache",
        },
        body: await chatCompletionStreamToResponsesSseText(upstreamResponse, upstreamBody),
      };
    }

    return {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("content-type") ?? "text/event-stream",
      },
      body: await upstreamResponse.text(),
    };
  }
  const upstreamText = await upstreamResponse.text();

  if (input.route.kind === "responses" && upstreamResponse.ok) {
    return jsonResult(
      upstreamResponse.status,
      chatCompletionResponseToResponsesResponse(parseGatewayJsonBody(upstreamText)),
    );
  }

  return {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") ?? "application/json",
    },
    body: upstreamText,
  };
}

function responseRequestToChatCompletionRequest(body: Record<string, unknown>) {
  const input = body.input;
  const messages = Array.isArray(input)
    ? input.flatMap(responseInputItemToChatCompletionMessage)
    : typeof input === "string"
      ? [{ role: "user", content: input }]
      : [];
  const tools = responseToolsToChatCompletionTools(body.tools);

  return {
    ...body,
    messages,
    max_tokens: body.max_output_tokens ?? body.max_tokens,
    ...(tools.length > 0 ? { tools } : { tools: undefined }),
    tool_choice: responseToolChoiceToChatCompletionToolChoice(body.tool_choice),
    input: undefined,
    max_output_tokens: undefined,
  };
}

function responseInputItemToChatCompletionMessage(item: unknown): unknown[] {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [];
  }

  const record = item as Record<string, unknown>;
  if (record.role !== "developer") {
    return [normalizeResponseMessageContent(record)];
  }

  return [
    normalizeResponseMessageContent({
      ...record,
      role: "system",
    }),
  ];
}

function normalizeResponseMessageContent(message: Record<string, unknown>): Record<string, unknown> {
  const content = message.content;
  if (!Array.isArray(content)) {
    return message;
  }

  return {
    ...message,
    content: content.map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        return part;
      }
      const record = part as Record<string, unknown>;
      if (record.type === "input_text" || record.type === "output_text") {
        return {
          ...record,
          type: "text",
        };
      }
      return record;
    }),
  };
}

function responseToolsToChatCompletionTools(tools: unknown): unknown[] {
  if (!Array.isArray(tools)) return [];

  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return [];
    const record = tool as Record<string, unknown>;
    if (record.type !== "function") return [];

    if (record.function && typeof record.function === "object" && !Array.isArray(record.function)) {
      return [record];
    }

    if (typeof record.name !== "string" || !record.name.trim()) return [];

    return [
      {
        type: "function",
        function: {
          name: record.name,
          ...(typeof record.description === "string" ? { description: record.description } : {}),
          ...(record.parameters !== undefined ? { parameters: record.parameters } : {}),
          ...(record.strict !== undefined ? { strict: record.strict } : {}),
        },
      },
    ];
  });
}

function responseToolChoiceToChatCompletionToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object" || Array.isArray(toolChoice)) {
    return toolChoice;
  }

  const record = toolChoice as Record<string, unknown>;
  if (record.type !== "function" || typeof record.name !== "string" || !record.name.trim()) {
    return toolChoice;
  }

  return {
    type: "function",
    function: {
      name: record.name,
    },
  };
}

function chatCompletionResponseToResponsesResponse(body: Record<string, unknown> | null) {
  const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined;
  const message =
    choice && typeof choice === "object" && "message" in choice
      ? (choice.message as { content?: unknown })
      : undefined;
  const text = typeof message?.content === "string" ? message.content : "";

  return {
    id: typeof body?.id === "string" ? body.id : `resp_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: typeof body?.model === "string" ? body.model : undefined,
    output: [
      {
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    output_text: text,
    usage: body?.usage,
  };
}

async function pipeChatCompletionStreamAsResponsesStream(
  res: http.ServerResponse,
  response: Response,
  requestBody: Record<string, unknown>,
): Promise<void> {
  res.writeHead(response.status, {
    "Content-Type": "text/event-stream",
    "Cache-Control": response.headers.get("cache-control") ?? "no-cache",
    "Connection": "keep-alive",
  });

  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = `resp_${Date.now()}`;
  const messageId = `msg_${Date.now()}`;
  const model = typeof requestBody.model === "string" ? requestBody.model : undefined;
  let outputText = "";

  writeSseEvent(res, "response.created", responseCreatedEvent(responseId, createdAt, model));
  writeSseEvent(res, "response.output_item.added", responseOutputItemAddedEvent(messageId));
  writeSseEvent(res, "response.content_part.added", responseContentPartAddedEvent(messageId));

  for await (const delta of readChatCompletionStreamTextDeltas(response.body)) {
    outputText += delta;
    writeSseEvent(res, "response.output_text.delta", responseOutputTextDeltaEvent(messageId, delta));
  }

  writeResponsesCompletionSseEvents(res, {
    responseId,
    messageId,
    createdAt,
    outputText,
    model,
  });
  res.end();
}

async function chatCompletionStreamToResponsesSseText(
  response: Response,
  requestBody: Record<string, unknown>,
): Promise<string> {
  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = `resp_${Date.now()}`;
  const messageId = `msg_${Date.now()}`;
  const model = typeof requestBody.model === "string" ? requestBody.model : undefined;
  let outputText = "";
  let output =
    responseSseEventString("response.created", responseCreatedEvent(responseId, createdAt, model)) +
    responseSseEventString("response.output_item.added", responseOutputItemAddedEvent(messageId)) +
    responseSseEventString("response.content_part.added", responseContentPartAddedEvent(messageId));

  for await (const delta of readChatCompletionStreamTextDeltas(response.body)) {
    outputText += delta;
    output += responseSseEventString(
      "response.output_text.delta",
      responseOutputTextDeltaEvent(messageId, delta),
    );
  }

  output += responsesCompletionSseEventsString({
    responseId,
    messageId,
    createdAt,
    outputText,
    model,
  });
  return output;
}

function responseCreatedEvent(responseId: string, createdAt: number, model: string | undefined) {
  return {
    type: "response.created",
    response: {
      id: responseId,
      object: "response",
      created_at: createdAt,
      status: "in_progress",
      ...(model ? { model } : {}),
      output: [],
    },
  };
}

function responseOutputItemAddedEvent(messageId: string) {
  return {
    type: "response.output_item.added",
    output_index: 0,
    item: {
      id: messageId,
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [],
    },
  };
}

function responseContentPartAddedEvent(messageId: string) {
  return {
    type: "response.content_part.added",
    item_id: messageId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "" },
  };
}

function responseOutputTextDeltaEvent(messageId: string, delta: string) {
  return {
    type: "response.output_text.delta",
    item_id: messageId,
    output_index: 0,
    content_index: 0,
    delta,
  };
}

function writeResponsesCompletionSseEvents(
  res: http.ServerResponse,
  input: {
    responseId: string;
    messageId: string;
    createdAt: number;
    outputText: string;
    model: string | undefined;
  },
): void {
  writeSseEvent(res, "response.output_text.done", {
    type: "response.output_text.done",
    item_id: input.messageId,
    output_index: 0,
    content_index: 0,
    text: input.outputText,
  });
  writeSseEvent(res, "response.content_part.done", {
    type: "response.content_part.done",
    item_id: input.messageId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: input.outputText },
  });
  writeSseEvent(res, "response.output_item.done", {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      id: input.messageId,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: input.outputText }],
    },
  });
  writeSseEvent(res, "response.completed", {
    type: "response.completed",
    response: {
      id: input.responseId,
      object: "response",
      created_at: input.createdAt,
      status: "completed",
      ...(input.model ? { model: input.model } : {}),
      output: [
        {
          id: input.messageId,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: input.outputText }],
        },
      ],
      output_text: input.outputText,
    },
  });
}

function responsesCompletionSseEventsString(input: {
  responseId: string;
  messageId: string;
  createdAt: number;
  outputText: string;
  model: string | undefined;
}): string {
  const chunks: string[] = [];
  const res = {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
  } as http.ServerResponse;
  writeResponsesCompletionSseEvents(res, input);
  return chunks.join("");
}

async function* readChatCompletionStreamTextDeltas(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (!body) return;

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const delta = parseChatCompletionSseTextDelta(event);
      if (delta) {
        yield delta;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const delta = parseChatCompletionSseTextDelta(buffer);
    if (delta) {
      yield delta;
    }
  }
}

function parseChatCompletionSseTextDelta(event: string): string | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return undefined;

  const parsed = parseGatewayJsonBody(data);
  const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : undefined;
  if (!choice || typeof choice !== "object") return undefined;
  const delta =
    "delta" in choice && choice.delta && typeof choice.delta === "object"
      ? (choice.delta as { content?: unknown })
      : undefined;
  return typeof delta?.content === "string" ? delta.content : undefined;
}

function writeSseEvent(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(responseSseEventString(event, data));
}

function responseSseEventString(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseGatewayJsonBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getDeepSeekApiKey(): string | undefined {
  return getRuntimeDeepSeekApiKey() ?? process.env.DEEPSEEK_API_KEY?.trim();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isStreamingResponse(body: Record<string, unknown>, response: Response): boolean {
  return Boolean(body.stream) && response.body !== null;
}

async function pipeUpstreamStream(res: http.ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
    "Cache-Control": response.headers.get("cache-control") ?? "no-cache",
    "Connection": "keep-alive",
  });
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body) {
    res.write(chunk);
  }
  res.end();
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function writeTextResponse(res: http.ServerResponse, response: Response, body: string): void {
  res.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") ?? "application/json",
  });
  res.end(body);
}

function jsonResult(status: number, body: unknown) {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
