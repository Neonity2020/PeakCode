import type http from "node:http";

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

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
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

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
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
    ? input
    : typeof input === "string"
      ? [{ role: "user", content: input }]
      : [];

  return {
    ...body,
    messages,
    max_tokens: body.max_output_tokens ?? body.max_tokens,
    input: undefined,
    max_output_tokens: undefined,
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
