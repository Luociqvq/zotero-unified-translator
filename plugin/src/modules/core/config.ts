import type { FullOutputMode } from "../../contracts/backend.js";
import type { LanguageCode } from "../../contracts/translation.js";

export interface InstantProviderConfig {
  endpoint: string;
  model: string;
  apiKeyRef: string;
  [key: string]: string;
}

export interface ZutConfig {
  schemaVersion: 4;
  instant: {
    defaultProvider: string;
    targetLanguage: Exclude<LanguageCode, "auto">;
    saveAnnotation: boolean;
    providers: Record<string, InstantProviderConfig>;
  };
  full: {
    endpoint: string;
    defaultEngine: string;
    defaultOutputMode: FullOutputMode;
    backendTokenRef: string;
  };
  ui: {
    showProgressNotifications: boolean;
  };
}

export interface PreferenceStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

class MemoryPreferenceStore implements PreferenceStore {
  private readonly values = new Map<string, unknown>();

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

const DEFAULT_TRANSLATION_ENDPOINT = "https://fanyi.eieu.cn/v1";
const DEFAULT_TRANSLATION_MODEL = "HY-MT1.5-1.8B";
const DEFAULT_FULL_ENDPOINT = "https://pdf2zh.eieu.cn";
const LEGACY_LOCAL_FULL_ENDPOINT = "http://127.0.0.1:8890";
const LEGACY_OPENAI_ENDPOINT = "https://api.openai.com/v1";
const LEGACY_OPENAI_MODEL = "gpt-4o-mini";

const OPENAI_PROVIDER_DEFAULTS: InstantProviderConfig = {
  endpoint: DEFAULT_TRANSLATION_ENDPOINT,
  model: DEFAULT_TRANSLATION_MODEL,
  apiKeyRef: "instant.openai-compatible.apiKey",
};

function defaultConfig(): ZutConfig {
  return {
    schemaVersion: 4,
    instant: {
      defaultProvider: "openai-compatible",
      targetLanguage: "zh-CN",
      saveAnnotation: true,
      providers: {
        "openai-compatible": { ...OPENAI_PROVIDER_DEFAULTS },
      },
    },
    full: {
      endpoint: DEFAULT_FULL_ENDPOINT,
      defaultEngine: "pdf2zh_next",
      defaultOutputMode: "bilingual",
      backendTokenRef: "backend.token",
    },
    ui: {
      showProgressNotifications: true,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function zoteroPreferenceStore(): PreferenceStore {
  const host = globalThis as typeof globalThis & {
    Zotero?: {
      Prefs?: {
        get(key: string, global?: boolean): unknown;
        set(key: string, value: unknown, global?: boolean): void;
      };
    };
  };
  if (!host.Zotero?.Prefs) {
    return new MemoryPreferenceStore();
  }
  return {
    get: (key) => host.Zotero?.Prefs?.get(key, true) || host.Zotero?.Prefs?.get(key),
    set: (key, value) => host.Zotero?.Prefs?.set(key, value, true),
  };
}

export class ConfigStore {
  private static readonly preferenceKey = "extensions.zut.config";

  constructor(private readonly preferences: PreferenceStore = zoteroPreferenceStore()) {}

  load(): ZutConfig {
    const raw = this.preferences.get(ConfigStore.preferenceKey);
    if (typeof raw !== "string") {
      return defaultConfig();
    }
    try {
      return this.migrate(JSON.parse(raw));
    } catch {
      return defaultConfig();
    }
  }

  save(config: ZutConfig): void {
    const normalized = this.migrate(config);
    this.preferences.set(ConfigStore.preferenceKey, JSON.stringify(normalized));
  }

  private migrate(input: unknown): ZutConfig {
    const base = defaultConfig();
    const source = asRecord(input);
    const sourceSchema =
      typeof source.schemaVersion === "number" ? source.schemaVersion : 0;
    const sourceInstant = asRecord(source.instant);
    const sourceFull = asRecord(source.full);
    const sourceUI = asRecord(source.ui);
    const sourceProviders = asRecord(sourceInstant.providers);
    let sourceDefaultProvider = stringValue(
      sourceInstant.defaultProvider,
      base.instant.defaultProvider,
    );
    const sourceOpenAIProvider = stringRecord(sourceProviders["openai-compatible"]);
    const openAIProvider = {
      ...base.instant.providers["openai-compatible"],
      ...sourceOpenAIProvider,
    } as InstantProviderConfig;
    // 0.1.0 previously defaulted to Google/OpenAI. Preserve deliberate custom
    // settings, but move untouched legacy defaults to the configured HY service.
    if (sourceSchema < 3 && sourceDefaultProvider === "google-free") {
      sourceDefaultProvider = base.instant.defaultProvider;
    }
    if (
      sourceSchema < 3 &&
      (!sourceOpenAIProvider.endpoint ||
        sourceOpenAIProvider.endpoint === LEGACY_OPENAI_ENDPOINT)
    ) {
      openAIProvider.endpoint = DEFAULT_TRANSLATION_ENDPOINT;
    }
    if (
      sourceSchema < 3 &&
      (!sourceOpenAIProvider.model || sourceOpenAIProvider.model === LEGACY_OPENAI_MODEL)
    ) {
      openAIProvider.model = DEFAULT_TRANSLATION_MODEL;
    }
    const targetLanguage = stringValue(
      sourceInstant.targetLanguage,
      base.instant.targetLanguage,
    ) as Exclude<LanguageCode, "auto">;
    const outputMode = stringValue(
      sourceFull.defaultOutputMode,
      base.full.defaultOutputMode,
    );
    const sourceFullEndpoint = stringValue(sourceFull.endpoint, base.full.endpoint)
      .trim()
      .replace(/\/+$/, "");
    const fullEndpoint =
      sourceSchema < 4 &&
      (!sourceFull.endpoint || sourceFullEndpoint === LEGACY_LOCAL_FULL_ENDPOINT)
        ? DEFAULT_FULL_ENDPOINT
        : sourceFullEndpoint || base.full.endpoint;

    return {
      schemaVersion: 4,
      instant: {
        defaultProvider:
          sourceDefaultProvider === "google-free" ||
          sourceDefaultProvider === "openai-compatible"
            ? sourceDefaultProvider
            : base.instant.defaultProvider,
        targetLanguage: [
          "zh-CN",
          "zh-TW",
          "en",
          "ja",
          "ko",
          "de",
          "fr",
          "es",
        ].includes(targetLanguage)
          ? targetLanguage
          : base.instant.targetLanguage,
        saveAnnotation:
          typeof sourceInstant.saveAnnotation === "boolean"
            ? sourceInstant.saveAnnotation
            : base.instant.saveAnnotation,
        providers: {
          "openai-compatible": openAIProvider,
        },
      },
      full: {
        endpoint: fullEndpoint,
        defaultEngine: stringValue(
          sourceFull.defaultEngine,
          base.full.defaultEngine,
        ),
        defaultOutputMode:
          outputMode === "translated" || outputMode === "bilingual"
            ? outputMode
            : base.full.defaultOutputMode,
        backendTokenRef: stringValue(
          sourceFull.backendTokenRef,
          base.full.backendTokenRef,
        ),
      },
      ui: {
        showProgressNotifications:
          typeof sourceUI.showProgressNotifications === "boolean"
            ? sourceUI.showProgressNotifications
            : base.ui.showProgressNotifications,
      },
    };
  }
}

export function getOpenAIProviderConfig(config: ZutConfig): InstantProviderConfig {
  return {
    ...OPENAI_PROVIDER_DEFAULTS,
    ...config.instant.providers["openai-compatible"],
  };
}
