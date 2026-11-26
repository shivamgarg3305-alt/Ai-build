import { AppError } from '../errors';
import type { AiProvider } from './types';

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();
  private defaultName: string | null = null;

  register(provider: AiProvider, options: { default?: boolean } = {}): void {
    if (this.providers.has(provider.name)) throw new Error(`AI provider already registered: ${provider.name}`);
    this.providers.set(provider.name, provider);
    if (options.default || this.defaultName === null) this.defaultName = provider.name;
  }

  list(): string[] {
    return [...this.providers.keys()];
  }

  /** Returns the named provider, or the default one. Throws a 501 when none is configured. */
  get(name?: string): AiProvider {
    const key = name ?? this.defaultName;
    const provider = key ? this.providers.get(key) : undefined;
    if (!provider) {
      throw AppError.notImplemented('ai_provider_not_configured', 'No AI provider is configured.');
    }
    return provider;
  }
}
