import type { ReaderSelection } from "../reader/bridge.js";
import type { TranslationResult } from "../../contracts/translation.js";

export interface TranslationPopupActions {
  translate(
    signal: AbortSignal,
    setStatus: (message: string) => void,
  ): Promise<TranslationResult>;
  save?(result: TranslationResult): Promise<boolean>;
}

function button(document: Document, label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  Object.assign(element.style, {
    border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
    borderRadius: "4px",
    minWidth: "0",
    minHeight: "28px",
    padding: "4px 10px",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    lineHeight: "1.2",
    whiteSpace: "nowrap",
  });
  return element;
}

function copyText(document: Document, text: string): Promise<void> {
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard) {
    return clipboard.writeText(text);
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  return Promise.resolve();
}

export class TranslationPopup {
  private readonly controllers = new Set<AbortController>();

  show(selection: ReaderSelection, actions: TranslationPopupActions): void {
    const document = selection.doc;
    const container = document.createElement("div");
    container.setAttribute("role", "status");
    container.dataset.zutPopup = "true";
    Object.assign(container.style, {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: "6px",
      boxSizing: "border-box",
      width: "min(360px, calc(100vw - 32px))",
      minWidth: "240px",
      maxWidth: "calc(100vw - 32px)",
      maxHeight: "min(320px, 42vh)",
      overflowY: "auto",
      padding: "8px 10px",
      border: "1px solid color-mix(in srgb, currentColor 20%, transparent)",
      borderRadius: "6px",
      background: "Canvas",
      color: "CanvasText",
      boxShadow: "0 4px 16px rgb(0 0 0 / 18%)",
      font: "12.5px/1.45 system-ui, sans-serif",
    });

    const status = document.createElement("div");
    status.textContent = "正在翻译 · 0.0 秒";
    Object.assign(status.style, {
      minHeight: "20px",
      opacity: "0.78",
      overflowWrap: "anywhere",
    });
    const result = document.createElement("div");
    Object.assign(result.style, {
      minHeight: "24px",
      maxHeight: "140px",
      overflowY: "auto",
      padding: "6px 8px",
      border: "1px solid color-mix(in srgb, currentColor 12%, transparent)",
      borderRadius: "4px",
      background: "rgb(127 127 127 / 8%)",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    });
    const actionsRow = document.createElement("div");
    Object.assign(actionsRow.style, {
      display: "flex",
      gap: "6px",
      alignItems: "center",
      justifyContent: "flex-end",
      flexWrap: "wrap",
    });
    const copy = button(document, "复制");
    const save = button(document, "保存到注释");
    const retry = button(document, "重试");
    copy.disabled = true;
    save.disabled = true;
    save.hidden = !actions.save;
    retry.hidden = true;
    actionsRow.append(copy, save, retry);
    container.append(status, result, actionsRow);

    // append() must run synchronously while Zotero is rendering the popup.
    selection.append(container);

    let latestResult: TranslationResult | undefined;
    let controller: AbortController | undefined;
    const setBusy = (busy: boolean) => {
      copy.disabled = busy || !latestResult;
      save.disabled = busy || !latestResult || !actions.save;
      retry.disabled = busy;
    };
    const run = async () => {
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      this.controllers.add(currentController);
      latestResult = undefined;
      result.textContent = "";
      retry.hidden = true;
      setBusy(true);
      const startedAt = Date.now();
      let progressMessage = "正在翻译";
      const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`;
      const elapsedTimer = setInterval(() => {
        if (!latestResult) {
          status.textContent = `${progressMessage} · ${elapsed()}`;
        }
      }, 200);
      status.textContent = `${progressMessage} · ${elapsed()}`;
      try {
        latestResult = await actions.translate(currentController.signal, (message) => {
          progressMessage = message;
          status.textContent = `${message} · ${elapsed()}`;
        });
        result.textContent = latestResult.text;
        status.textContent = latestResult.model
          ? `已完成 · ${latestResult.provider} · ${latestResult.model} · ${elapsed()}`
          : `已完成 · ${latestResult.provider} · ${elapsed()}`;
        setBusy(false);
      } catch (error) {
        if (currentController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        const message = error instanceof Error ? error.message : "翻译失败";
        status.textContent = message;
        retry.hidden = false;
        setBusy(false);
      } finally {
        clearInterval(elapsedTimer);
        this.controllers.delete(currentController);
      }
    };

    copy.addEventListener("click", () => {
      if (!latestResult) return;
      void copyText(document, latestResult.text)
        .then(() => {
          status.textContent = "已复制译文";
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : "复制失败";
        });
    });
    save.addEventListener("click", () => {
      if (!latestResult || !actions.save) return;
      save.disabled = true;
      void actions.save(latestResult)
        .then((created) => {
          status.textContent = created ? "已保存到注释" : "注释中已存在相同译文";
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : "保存注释失败";
          save.disabled = false;
        });
    });
    retry.addEventListener("click", () => {
      void run();
    });

    void run();
  }

  dispose(): void {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
