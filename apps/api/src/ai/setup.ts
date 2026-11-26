import type { AppConfig } from '../env';
import type { AiProviderRegistry } from './registry';
import { GeminiProvider } from './gemini';

/**
 * Registers the configured provider in the EXISTING registry. Registers nothing unless activation is
 * "active" (enabled + key + terms confirmed), so an unconfigured deployment can never transmit anything.
 * Returns whether a provider was registered.
 */
export function registerAiProviders(registry: AiProviderRegistry, config: AppConfig, options: { fetch?: typeof fetch } = {}): boolean {
  const ai = config.ai;
  if (ai.activation !== 'active' || !ai.apiKey) return false;
  registry.register(
    new GeminiProvider({
      apiKey: ai.apiKey,
      model: ai.model,
      baseUrl: ai.baseUrl,
      timeoutMs: ai.timeoutMs,
      temperature: ai.temperature,
      maxOutputTokens: ai.maxOutputTokens,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    { default: true },
  );
  return true;
}
