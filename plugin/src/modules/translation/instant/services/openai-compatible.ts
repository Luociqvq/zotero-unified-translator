import type {
  InstantTranslator,
  TranslationRequest,
  TranslationResult,
} from "../../../../contracts/translation.js";
import { requestJson } from "../../../utils/http.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/-\s*\n\s*(?=[a-z])/gi, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function targetLanguageLabel(code: string): string {
  switch (code) {
    case "zh-CN":
      return "Simplified Chinese (简体中文, not Traditional Chinese)";
    case "zh-TW":
      return "Traditional Chinese (繁體中文)";
    case "en":
      return "English";
    case "ja":
      return "Japanese";
    case "ko":
      return "Korean";
    case "de":
      return "German";
    case "fr":
      return "French";
    case "es":
      return "Spanish";
    default:
      return code;
  }
}

export class OpenAICompatibleTranslator implements InstantTranslator {
  readonly id = "openai-compatible";
  readonly displayName = "HY-MT1.5-1.8B（OpenAI 兼容）";
  readonly capabilities = {
    sourceLanguages: "auto" as const,
    targetLanguages: ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "es"],
    maxCharacters: 12000,
    supportsContext: true,
  };

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    if (!this.apiKey.trim()) {
      throw new Error("OpenAI-compatible API Key 未配置，请先打开插件设置");
    }
    if (!this.endpoint.trim() || !this.model.trim()) {
      throw new Error("OpenAI-compatible 服务地址或模型未配置");
    }
    const endpoint = this.endpoint.replace(/\/+$/, "");
    const normalizedText = normalizeText(request.text);
    if (!normalizedText) {
      throw new Error("selected text is empty");
    }
    const response = await requestJson<ChatResponse>(endpoint + "/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Translate accurately. Preserve formulas, citations, names, and markup. Follow the target language exactly. Return only the translation.",
          },
          {
            role: "user",
            content:
              (request.context ? "Context:\n" + request.context + "\n\n" : "") +
              "Translate to " +
              targetLanguageLabel(request.targetLanguage) +
              ":\n" +
              normalizedText,
          },
        ],
      }),
    });
    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("LLM returned an empty translation");
    }
    return {
      text,
      provider: this.id,
      model: this.model,
    };
  }
}
