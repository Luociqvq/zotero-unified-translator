import type { ReaderSelection } from "./modules/reader/bridge.js";
import { ReaderBridge } from "./modules/reader/bridge.js";
import { ConfigStore, getOpenAIProviderConfig } from "./modules/core/config.js";
import { createCredentialStore } from "./modules/storage/credentials.js";
import { TranslationCoordinator } from "./modules/translation/coordinator.js";
import { createDefaultRegistry } from "./modules/translation/instant/registry.js";
import { saveTranslationToAnnotation } from "./modules/translation/instant/annotation.js";
import {
  FullTranslationClient,
  FullTranslationTaskError,
} from "./modules/translation/full/client.js";
import {
  clientRequestId,
  findExistingTranslation,
  importTranslatedPDF,
  readPDFSource,
  translatedAttachmentTitle,
} from "./modules/translation/full/attachment.js";
import {
  TranslationPopup,
  type TranslationPopupActions,
} from "./modules/ui/popup.js";
import {
  registerItemMenu,
  type MenuRegistration,
} from "./modules/ui/menu.js";
import type { FullTask } from "./contracts/backend.js";
import type { TranslationResult } from "./contracts/translation.js";
import hooks from "./hooks.js";

interface ProgressWindowLike {
  changeHeadline(text: string, icon?: string, postText?: string): void;
  addDescription(text: string): void;
  show(): boolean;
  startCloseTimer(milliseconds: number): void;
  close(): void;
}

interface ProgressWindowConstructor {
  new (options?: { window?: Window; closeOnClick?: boolean }): ProgressWindowLike;
}

interface ProgressReporter {
  update(message: string, progress?: number): void;
  complete(message: string): void;
  fail(message: string): void;
}

function createProgressReporter(
  window: Window,
  enabled: boolean,
): ProgressReporter {
  const Constructor = (Zotero as unknown as {
    ProgressWindow?: ProgressWindowConstructor;
  }).ProgressWindow;
  if (!enabled || !Constructor) {
    return {
      update() {},
      complete() {},
      fail() {},
    };
  }
  try {
    const progress = new Constructor({ window, closeOnClick: true });
    progress.changeHeadline("Zotero Unified Translator");
    progress.show();
    return {
      update(message, value) {
        const suffix = typeof value === "number" ? ` · ${value}%` : "";
        progress.changeHeadline("Zotero Unified Translator", undefined, message + suffix);
      },
      complete(message) {
        progress.changeHeadline("Zotero Unified Translator", undefined, message);
        progress.startCloseTimer(3_000);
      },
      fail(message) {
        progress.changeHeadline("Zotero Unified Translator", undefined, "失败");
        progress.addDescription(message);
        progress.startCloseTimer(8_000);
      },
    };
  } catch {
    return {
      update() {},
      complete() {},
      fail() {},
    };
  }
}

function taskMessage(task: FullTask): string {
  const labels: Record<string, string> = {
    queued: "排队中",
    starting: "启动引擎",
    processing: "翻译中",
    reading: "读取 PDF",
    translating: "翻译页面",
    finalizing: "生成 PDF",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败",
  };
  return `${labels[task.stage] ?? labels[task.state] ?? task.stage} · ${task.progress}%`;
}

function activeWindow(): Window {
  return (Zotero.getMainWindow?.() ?? Zotero.getMainWindows()[0]) as unknown as Window;
}

function showAlert(window: Window, title: string, message: string): void {
  if (Zotero.alert) {
    Zotero.alert(window, title, message);
  } else {
    window.alert(`${title}\n\n${message}`);
  }
}

const CONNECTION_CHECK_TIMEOUT_MS = 15_000;
const INSTANT_CACHE_TTL_MS = 5 * 60 * 1000;
const INSTANT_CACHE_LIMIT = 32;

async function withConnectionCheckTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECTION_CHECK_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`接口请求超时（${CONNECTION_CHECK_TIMEOUT_MS / 1000} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export class ZutAddon {
  readonly data = {
    alive: true,
    initialized: false,
  };
  readonly hooks = hooks;
  readonly config = new ConfigStore();
  readonly readerBridge = new ReaderBridge();
  readonly popup = new TranslationPopup();
  private readonly credentials = createCredentialStore();
  private readonly instantCache = new Map<
    string,
    { result: TranslationResult; expiresAt: number }
  >();
  private readerUnsubscribe?: () => void;
  private menu?: MenuRegistration;
  private activated = false;
  private readonly mainWindows = new Set<Window>();

  activate(): void {
    if (this.activated) {
      return;
    }
    this.activated = true;
    this.config.load();
    this.readerUnsubscribe = this.readerBridge.onSelection((selection) => {
      this.showSelectionPopup(selection);
    });
    this.readerBridge.register((reader) => {
      const itemID =
        typeof reader.itemID === "number" ? reader.itemID : reader._item?.id;
      const item =
        typeof itemID === "number" ? Zotero.Items.get(itemID) : undefined;
      if (!item) {
        showAlert(activeWindow(), "ZUT", "无法确定当前 PDF 附件。");
        return;
      }
      return this.translateSelectedItems(activeWindow(), [item]);
    });
    this.menu = registerItemMenu((items) =>
      this.translateSelectedItems(activeWindow(), items),
    );
  }

  attachMainWindow(window: Window): void {
    this.mainWindows.add(window);
  }

  detachMainWindow(window: Window): void {
    this.mainWindows.delete(window);
  }

  detachMainWindows(): void {
    this.mainWindows.clear();
  }

  private showSelectionPopup(selection: ReaderSelection): void {
    const config = this.config.load();
    const targetLanguage = config.instant.targetLanguage;
    const providerID = config.instant.defaultProvider;
    const providerConfig = getOpenAIProviderConfig(config);
    const cacheKey = JSON.stringify([
      providerID,
      targetLanguage,
      providerConfig.endpoint,
      providerConfig.model,
      selection.text,
    ]);
    const actions: TranslationPopupActions = {
      translate: async (signal, setStatus) => {
        const cached = this.instantCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          setStatus("使用缓存");
          return cached.result;
        }
        this.instantCache.delete(cacheKey);
        setStatus("请求中");
        const apiKey =
          providerID === "openai-compatible"
            ? await this.credentials.get(providerConfig.apiKeyRef)
            : undefined;
        const coordinator = new TranslationCoordinator(
          createDefaultRegistry(
            providerID === "openai-compatible"
              ? {
                  endpoint: providerConfig.endpoint,
                  model: providerConfig.model,
                  apiKey,
                }
              : undefined,
          ),
        );
        setStatus("等待返回");
        const result = await coordinator.translate(
          providerID,
          {
            text: selection.text,
            sourceLanguage: selection.sourceLanguage,
            targetLanguage,
          },
          signal,
        );
        this.instantCache.set(cacheKey, {
          result,
          expiresAt: Date.now() + INSTANT_CACHE_TTL_MS,
        });
        while (this.instantCache.size > INSTANT_CACHE_LIMIT) {
          const oldest = this.instantCache.keys().next().value;
          if (typeof oldest !== "string") break;
          this.instantCache.delete(oldest);
        }
        return result;
      },
    };
    if (config.instant.saveAnnotation) {
      actions.save = async (result) => {
        const reader = selection.reader as _ZoteroTypes.ReaderInstance & {
          _item?: { id?: number };
        };
        const itemID =
          typeof reader.itemID === "number" ? reader.itemID : reader._item?.id;
        if (typeof itemID !== "number") {
          throw new Error("无法确定当前 PDF 附件");
        }
        const attachment = Zotero.Items.get(itemID);
        if (!attachment || !attachment.isPDFAttachment()) {
          throw new Error("当前 Reader 不是 PDF 附件");
        }
        return saveTranslationToAnnotation(
          attachment,
          selection.annotation,
          result.text,
          result.provider,
          targetLanguage,
        );
      };
    }
    this.popup.show(
      {
        ...selection,
        targetLanguage,
      },
      actions,
    );
  }

  private async translateSelectedItems(
    window: Window,
    items: Zotero.Item[],
  ): Promise<void> {
    if (items.length !== 1 || !items[0]) {
      showAlert(window, "ZUT", "请一次选择一个文献条目或 PDF 附件。");
      return;
    }
    const config = this.config.load();
    const progress = createProgressReporter(
      window,
      config.ui.showProgressNotifications,
    );
    try {
      progress.update("正在读取 PDF", 1);
      const source = await readPDFSource(items[0]);
      const title = translatedAttachmentTitle(
        source,
        config.instant.targetLanguage,
        config.full.defaultOutputMode,
        config.full.defaultEngine,
      );
      const existing = findExistingTranslation(source, title);
      if (existing) {
        progress.complete("已存在相同译文附件，未重复创建");
        return;
      }

      if (!config.full.endpoint) {
        throw new Error("整篇翻译后端地址未配置，请先打开插件设置");
      }
      const token = await this.credentials.get(config.full.backendTokenRef);
      const client = new FullTranslationClient(config.full.endpoint, token);
      progress.update("正在检查后端和 PDF 引擎", 3);
      const health = await client.health();
      const engine = health.engines.find(
        (candidate) => candidate.id === config.full.defaultEngine,
      );
      if (!engine?.available) {
        throw new Error(
          engine
            ? `PDF 引擎不可用：${engine.reason}`
            : `后端未启用引擎：${config.full.defaultEngine}`,
        );
      }

      const fileData = new ArrayBuffer(source.bytes.byteLength);
      new Uint8Array(fileData).set(source.bytes);
      const file = new Blob([fileData], { type: "application/pdf" });
      progress.update("正在上传 PDF", 5);
      const task = await client.createTask(file, source.filename, {
        sourceLanguage: "auto",
        targetLanguage: config.instant.targetLanguage,
        engine: config.full.defaultEngine,
        outputMode: config.full.defaultOutputMode,
        clientRequestId: clientRequestId(
          source,
          config.instant.targetLanguage,
          config.full.defaultEngine,
          config.full.defaultOutputMode,
        ),
      });
      const completed = await client.waitForCompletion(task, (current) => {
        progress.update(taskMessage(current), current.progress);
      });
      progress.update("正在下载译文 PDF", 98);
      const translated = await client.download(completed);
      progress.update("正在导入 Zotero 附件", 99);
      await importTranslatedPDF(source, completed, translated);
      progress.complete("译文附件已添加到 Zotero");
    } catch (error) {
      const message =
        error instanceof FullTranslationTaskError
          ? `${error.message}${error.retryable ? "（可以重试）" : ""}`
          : error instanceof Error
            ? error.message
            : "整篇 PDF 翻译失败";
      progress.fail(message);
      showAlert(window, "ZUT 整篇翻译失败", message);
    }
  }

  attachPreferences(window: Window): void {
    const document = window.document;
    const endpoint = document.getElementById("zut-backend-endpoint") as HTMLInputElement | null;
    const targetLanguage = document.getElementById("zut-target-language") as HTMLSelectElement | null;
    const saveAnnotation = document.getElementById("zut-save-annotation") as HTMLInputElement | null;
    const provider = document.getElementById("zut-instant-provider") as HTMLSelectElement | null;
    const openAIEndpoint = document.getElementById("zut-openai-endpoint") as HTMLInputElement | null;
    const openAIModel = document.getElementById("zut-openai-model") as HTMLInputElement | null;
    const openAIKey = document.getElementById("zut-openai-key") as HTMLInputElement | null;
    const backendToken = document.getElementById("zut-backend-token") as HTMLInputElement | null;
    const engine = document.getElementById("zut-full-engine") as HTMLSelectElement | null;
    const outputMode = document.getElementById("zut-output-mode") as HTMLSelectElement | null;
    const showProgress = document.getElementById("zut-show-progress") as HTMLInputElement | null;
    const diagnostics = document.getElementById("zut-diagnostics");
    const saveButton = document.getElementById("zut-save-settings");
    const instantTestButton = document.getElementById("zut-instant-test");
    const healthButton = document.getElementById("zut-health-check");
    const clearOpenAIButton = document.getElementById("zut-clear-openai-key");
    const clearBackendButton = document.getElementById("zut-clear-backend-token");
    if (
      !endpoint ||
      !targetLanguage ||
      !saveAnnotation ||
      !provider ||
      !openAIEndpoint ||
      !openAIModel ||
      !openAIKey ||
      !backendToken ||
      !engine ||
      !outputMode ||
      !showProgress ||
      !saveButton ||
      !healthButton
    ) {
      return;
    }
    if (saveButton.dataset.zutBound === "true") {
      return;
    }
    saveButton.dataset.zutBound = "true";
    const config = this.config.load();
    const providerConfig = getOpenAIProviderConfig(config);
    endpoint.value = config.full.endpoint;
    targetLanguage.value = config.instant.targetLanguage;
    saveAnnotation.checked = config.instant.saveAnnotation;
    provider.value = config.instant.defaultProvider;
    openAIEndpoint.value = providerConfig.endpoint;
    openAIModel.value = providerConfig.model;
    backendToken.value = "";
    openAIKey.value = "";
    engine.value = config.full.defaultEngine;
    outputMode.value = config.full.defaultOutputMode;
    showProgress.checked = config.ui.showProgressNotifications;

    saveButton.addEventListener("command", () => {
      void (async () => {
        const next = this.config.load();
        next.instant.defaultProvider = provider.value;
        next.instant.targetLanguage = targetLanguage.value as typeof next.instant.targetLanguage;
        next.instant.saveAnnotation = saveAnnotation.checked;
        next.instant.providers["openai-compatible"] = {
          endpoint: openAIEndpoint.value.trim().replace(/\/+$/, ""),
          model: openAIModel.value.trim(),
          apiKeyRef: providerConfig.apiKeyRef,
        };
        next.full.endpoint = endpoint.value.trim().replace(/\/+$/, "");
        next.full.defaultEngine = engine.value;
        next.full.defaultOutputMode = outputMode.value as typeof next.full.defaultOutputMode;
        next.ui.showProgressNotifications = showProgress.checked;
        this.config.save(next);
        if (openAIKey.value.trim()) {
          await this.credentials.set(providerConfig.apiKeyRef, openAIKey.value.trim());
        }
        if (backendToken.value.trim()) {
          await this.credentials.set(next.full.backendTokenRef, backendToken.value.trim());
        }
        if (diagnostics) {
          diagnostics.textContent =
            "设置已保存。密钥保存在 Zotero 凭据存储中，当前输入框会保留内容；重新打开设置页时不会回显密钥。";
        }
      })().catch((error: unknown) => {
        if (diagnostics) {
          diagnostics.textContent = error instanceof Error ? error.message : "设置保存失败";
        }
      });
    });
    const runInstantCheck = async () => {
      return withConnectionCheckTimeout(async (signal) => {
        const selectedProvider = provider.value;
        const apiKey =
          selectedProvider === "openai-compatible"
            ? openAIKey.value.trim() || (await this.credentials.get(providerConfig.apiKeyRef))
            : undefined;
        return new TranslationCoordinator(
          createDefaultRegistry(
            selectedProvider === "openai-compatible"
              ? {
                  endpoint: openAIEndpoint.value.trim().replace(/\/+$/, ""),
                  model: openAIModel.value.trim(),
                  apiKey,
                }
              : undefined,
          ),
        ).translate(
          selectedProvider,
          {
            text: "This is a connection test.",
            sourceLanguage: "auto",
            targetLanguage: targetLanguage.value as typeof config.instant.targetLanguage,
          },
          signal,
        );
      });
    };
    const runFullCheck = async () => {
      return withConnectionCheckTimeout(async (signal) => {
        const token =
          backendToken.value.trim() ||
          (await this.credentials.get(config.full.backendTokenRef));
        const health = await new FullTranslationClient(
          endpoint.value.trim().replace(/\/+$/, ""),
          token,
        ).health(signal);
        const selected = health.engines.find((item) => item.id === engine.value);
        if (!selected) {
          throw new Error(`后端在线，但未启用 ${engine.value}`);
        }
        if (!selected.available) {
          throw new Error(`PDF 引擎不可用：${selected.reason}`);
        }
        if (health.status !== "ok") {
          throw new Error(`整篇 PDF 后端状态为 ${health.status}`);
        }
        return health;
      });
    };
    instantTestButton?.addEventListener("command", () => {
      void (async () => {
        instantTestButton.setAttribute("disabled", "true");
        healthButton.setAttribute("disabled", "true");
        if (diagnostics) diagnostics.textContent = "正在测试即时翻译接口（最多等待 15 秒）...";
        const startedAt = Date.now();
        const result = await runInstantCheck();
        if (diagnostics) {
          diagnostics.textContent = `即时翻译测试成功（${result.model ?? result.provider}，耗时 ${Date.now() - startedAt} ms）：${result.text}`;
        }
      })()
        .catch((error: unknown) => {
          if (diagnostics) {
            diagnostics.textContent = error instanceof Error ? error.message : "即时翻译测试失败";
          }
        })
        .finally(() => {
          instantTestButton.removeAttribute("disabled");
          healthButton.removeAttribute("disabled");
        });
    });
    healthButton.addEventListener("command", () => {
      void (async () => {
        healthButton.setAttribute("disabled", "true");
        instantTestButton?.setAttribute("disabled", "true");
        if (diagnostics) {
          diagnostics.textContent = "正在同时检查即时翻译和整篇 PDF 接口（每项最多等待 15 秒）...";
        }
        const [instantResult, fullResult] = await Promise.allSettled([
          runInstantCheck(),
          runFullCheck(),
        ]);
        const errorMessage = (error: unknown): string =>
          error instanceof Error ? error.message : String(error);
        const instantStatus =
          instantResult.status === "fulfilled"
            ? `即时翻译接口：可用（${instantResult.value.model ?? instantResult.value.provider}）`
            : `即时翻译接口：不可用（${errorMessage(instantResult.reason)}）`;
        const fullStatus =
          fullResult.status === "fulfilled"
            ? `整篇 PDF 接口：可用（API ${fullResult.value.apiVersion} · ${engine.value}）`
            : `整篇 PDF 接口：不可用（${errorMessage(fullResult.reason)}）`;
        const allAvailable =
          instantResult.status === "fulfilled" && fullResult.status === "fulfilled";
        if (diagnostics) {
          diagnostics.textContent = [
            instantStatus,
            fullStatus,
            `整体检查：${allAvailable ? "两个接口均正常" : "未通过"}`,
          ].join("\n");
        }
      })()
        .catch((error: unknown) => {
          if (diagnostics) {
            diagnostics.textContent = error instanceof Error ? error.message : "双接口检查失败";
          }
        })
        .finally(() => {
          healthButton.removeAttribute("disabled");
          instantTestButton?.removeAttribute("disabled");
        });
    });
    clearOpenAIButton?.addEventListener("command", () => {
      void this.credentials
        .delete(providerConfig.apiKeyRef)
        .then(() => {
          openAIKey.value = "";
          if (diagnostics) diagnostics.textContent = "即时翻译 API Key 已清除。";
        })
        .catch((error: unknown) => {
          if (diagnostics) {
            diagnostics.textContent = error instanceof Error ? error.message : "清除 API Key 失败";
          }
        });
    });
    clearBackendButton?.addEventListener("command", () => {
      void this.credentials
        .delete(config.full.backendTokenRef)
        .then(() => {
          backendToken.value = "";
          if (diagnostics) diagnostics.textContent = "后端 Token 已清除。";
        })
        .catch((error: unknown) => {
          if (diagnostics) {
            diagnostics.textContent = error instanceof Error ? error.message : "清除后端 Token 失败";
          }
        });
    });
  }

  deactivate(): void {
    this.readerUnsubscribe?.();
    this.readerUnsubscribe = undefined;
    this.menu?.dispose();
    this.menu = undefined;
    this.readerBridge.dispose();
    this.popup.dispose();
    this.instantCache.clear();
    this.detachMainWindows();
    this.activated = false;
  }
}

export const addon = new ZutAddon();

const pluginGlobal = globalThis as typeof globalThis & {
  Zotero?: Record<string, unknown>;
  _globalThis?: Record<string, unknown>;
};
const globalRoot = pluginGlobal._globalThis ?? pluginGlobal;
if (pluginGlobal.Zotero && !pluginGlobal.Zotero.ZoteroUnifiedTranslator) {
  pluginGlobal.Zotero.ZoteroUnifiedTranslator = addon;
  (globalRoot as Record<string, unknown>).addon = addon;
}

export function activate(): void {
  addon.activate();
}

export function deactivate(): void {
  addon.deactivate();
}
