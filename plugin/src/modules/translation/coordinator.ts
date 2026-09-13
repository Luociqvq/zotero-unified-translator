import type {
  InstantTranslator,
  TranslationRequest,
  TranslationResult,
} from "../../contracts/translation.js";
import { InstantProviderRegistry } from "./instant/registry.js";

export class TranslationCoordinator {
  constructor(private readonly registry: InstantProviderRegistry) {}

  translate(
    providerId: string,
    request: TranslationRequest,
    signal: AbortSignal,
  ): Promise<TranslationResult> {
    const provider: InstantTranslator = this.registry.get(providerId);
    const limit = provider.capabilities.maxCharacters;
    if (limit && request.text.length > limit) {
      throw new Error(`选中文字过长，请缩短到 ${limit} 个字符以内，或使用整篇翻译。`);
    }
    return provider.translate(request, signal);
  }
}
