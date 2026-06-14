let runtimeDeepSeekApiKey: string | undefined;

export function updateRuntimeDeepSeekApiKey(apiKey: string | null): void {
  const normalized = apiKey?.trim();
  runtimeDeepSeekApiKey = normalized ? normalized : undefined;
}

export function getRuntimeDeepSeekApiKey(): string | undefined {
  return runtimeDeepSeekApiKey;
}
