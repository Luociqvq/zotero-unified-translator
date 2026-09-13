export type LanguageCode = "auto" | "zh-CN" | "zh-TW" | "en" | "ja" | "ko" | "de" | "fr" | "es";

export interface TranslationRequest {
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: Exclude<LanguageCode, "auto">;
  context?: string;
}

export interface TranslationResult {
  text: string;
  detectedSourceLanguage?: string;
  provider: string;
  model?: string;
}

export interface TranslatorCapabilities {
  sourceLanguages: string[] | "auto";
  targetLanguages: string[];
  maxCharacters?: number;
  supportsContext: boolean;
}

export interface InstantTranslator {
  id: string;
  displayName: string;
  capabilities: TranslatorCapabilities;
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
}
