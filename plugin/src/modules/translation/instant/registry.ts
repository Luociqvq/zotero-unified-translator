import type { InstantTranslator } from "../../../contracts/translation.js";
import { GoogleFreeTranslator } from "./services/google-free.js";
import { OpenAICompatibleTranslator } from "./services/openai-compatible.js";

export class InstantProviderRegistry {
  private readonly providers = new Map<string, InstantTranslator>();

  register(provider: InstantTranslator): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): InstantTranslator {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error("instant provider is not registered: " + id);
    }
    return provider;
  }

  list(): InstantTranslator[] {
    return [...this.providers.values()];
  }
}

export interface OpenAICompatibleOptions {
  endpoint: string;
  model: string;
  apiKey?: string;
}

export function createDefaultRegistry(
  openAI?: OpenAICompatibleOptions,
): InstantProviderRegistry {
  const registry = new InstantProviderRegistry();
  registry.register(new GoogleFreeTranslator());
  if (openAI) {
    registry.register(
      new OpenAICompatibleTranslator(
        openAI.endpoint,
        openAI.model,
        openAI.apiKey ?? "",
      ),
    );
  }
  return registry;
}
