import type {
  InstantTranslator,
  TranslationRequest,
  TranslationResult,
} from "../../../../contracts/translation.js";
import { requestJson } from "../../../utils/http.js";

type GoogleResponse = Array<Array<unknown> | string>;

function normalizeText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/-\s*\n\s*(?=[a-z])/gi, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export class GoogleFreeTranslator implements InstantTranslator {
  readonly id = "google-free";
  readonly displayName = "Google Translate（免 Key）";
  readonly capabilities = {
    sourceLanguages: "auto" as const,
    targetLanguages: ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "es"],
    maxCharacters: 4500,
    supportsContext: false,
  };

  async translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    const text = normalizeText(request.text);
    if (!text) {
      throw new Error("selected text is empty");
    }
    const query = new URLSearchParams({
      client: "gtx",
      sl: request.sourceLanguage === "auto" ? "auto" : request.sourceLanguage,
      tl: request.targetLanguage,
      dt: "t",
      q: text,
    });
    const payload = await requestJson<GoogleResponse>(
      "https://translate.googleapis.com/translate_a/single?" + query.toString(),
      { signal },
    );
    const segments = Array.isArray(payload[0]) ? payload[0] : [];
    const translation = segments
      .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
      .filter((segment): segment is string => typeof segment === "string")
      .join("");
    if (!translation) {
      throw new Error("Google returned an empty translation");
    }
    return {
      text: translation,
      provider: this.id,
    };
  }
}
