import type { ReaderSelection } from "../reader/bridge.js";
import type { TranslationResult } from "../../contracts/translation.js";

export interface TranslationPopupActions {
  translate(
    signal: AbortSignal,
    setStatus: (message: string) => void,
  ): Promise<TranslationResult>;
  save?(result: TranslationResult): Promise<boolean>;
}

type ButtonVariant = "primary" | "secondary" | "ghost";

function button(
  document: Document,
  label: string,
  variant: ButtonVariant = "secondary",
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  const base: Partial<CSSStyleDeclaration> = {
    border: "1px solid transparent",
    borderRadius: "5px",
    minWidth: "0",
    minHeight: "22px",
    padding: "2px 6px",
    cursor: "pointer",
    font: "inherit",
    fontWeight: "600",
    fontSize: "11px",
    lineHeight: "1.2",
    whiteSpace: "nowrap",
    transition: "opacity 120ms ease",
  };
  if (variant === "primary") {
    Object.assign(element.style, base, {
      background: "#2563eb",
      borderColor: "#2563eb",
      color: "#fff",
    });
  } else if (variant === "ghost") {
    Object.assign(element.style, base, {
      background: "transparent",
      borderColor: "color-mix(in srgb, currentColor 20%, transparent)",
      color: "inherit",
      fontWeight: "500",
    });
  } else {
    Object.assign(element.style, base, {
      background: "color-mix(in srgb, currentColor 5%, transparent)",
      borderColor: "color-mix(in srgb, currentColor 16%, transparent)",
      color: "inherit",
    });
  }
  element.addEventListener("mouseenter", () => {
    if (!element.disabled) element.style.opacity = "0.88";
  });
  element.addEventListener("mouseleave", () => {
    element.style.opacity = element.disabled ? "0.45" : "1";
  });
  return element;
}

function applyDisabled(el: HTMLButtonElement, disabled: boolean): void {
  el.disabled = disabled;
  el.style.opacity = disabled ? "0.45" : "1";
  el.style.cursor = disabled ? "default" : "pointer";
}

function copyText(document: Document, text: string): Promise<void> {
  // Zotero's helper works across the reader iframe / chrome boundary.
  try {
    Zotero.Utilities.Internal.copyTextToClipboard(text);
    return Promise.resolve();
  } catch {
    // fall through to DOM clipboard
  }
  const runFallback = (): void => {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.opacity = "0";
    (document.body || document.documentElement).appendChild(input);
    input.select();
    try {
      document.execCommand("copy");
    } finally {
      input.remove();
    }
  };
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    return clipboard.writeText(text).catch(() => {
      runFallback();
    });
  }
  runFallback();
  return Promise.resolve();
}

function ensureStyles(document: Document): void {
  if (document.getElementById("zut-popup-style")) return;
  const style = document.createElement("style");
  style.id = "zut-popup-style";
  style.textContent = `
@keyframes zut-spin { to { transform: rotate(360deg); } }
@keyframes zut-bar {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
[data-zut-popup="true"] .zut-spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, currentColor 16%, transparent);
  border-top-color: #2563eb;
  animation: zut-spin 0.75s linear infinite;
  flex: 0 0 auto;
}
[data-zut-popup="true"] .zut-progress {
  height: 2px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, currentColor 10%, transparent);
  position: relative;
}
[data-zut-popup="true"] .zut-progress::after {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  border-radius: inherit;
  background: #2563eb;
  animation: zut-bar 1s ease-in-out infinite;
}
[data-zut-popup="true"] .zut-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2563eb;
  flex: 0 0 auto;
}
[data-zut-popup="true"] .zut-status-dot[data-state="done"] { background: #16a34a; }
[data-zut-popup="true"] .zut-status-dot[data-state="error"] { background: #dc2626; }
[data-zut-popup="true"] .zut-result::-webkit-scrollbar { width: 6px; }
[data-zut-popup="true"] .zut-result::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 22%, transparent);
}
`;
  document.documentElement.appendChild(style);
}

const RESULT_MAX = "220px";
const PANEL_WIDTH = 420;

function isUiElement(node: unknown): node is HTMLElement {
  if (!node || typeof node !== "object") return false;
  const el = node as Partial<HTMLElement> & { nodeType?: number };
  // Reader iframe nodes may fail `instanceof HTMLElement` across compartments.
  return el.nodeType === 1 && typeof el.getBoundingClientRect === "function";
}

function isVisibleBarRect(rect: DOMRect): boolean {
  return rect.width > 80 && rect.height > 16 && rect.height < 180;
}

/** Bar counts as "on screen" only if it has size AND intersects the viewport. */
function isBarOnScreen(doc: Document, el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (!isVisibleBarRect(rect)) return false;
  const viewW = doc.defaultView?.innerWidth || 0;
  const viewH = doc.defaultView?.innerHeight || 0;
  if (!viewW || !viewH) return true;
  return rect.bottom > 0 && rect.top < viewH && rect.right > 0 && rect.left < viewW;
}

function isZutPanel(el: Element | null): boolean {
  let node: Element | null = el;
  while (node) {
    if ((node as HTMLElement).dataset?.zutPopup === "true") return true;
    if (node.getAttribute?.("data-zut-popup") === "true") return true;
    node = node.parentElement;
  }
  return false;
}

function findNativeSelectionPopup(doc: Document): HTMLElement | null {
  // Zotero's annotation bar is exactly ViewPopup with class "selection-popup".
  // Do NOT use loose heuristics — they can match our own translation panel
  // and then auto-close never fires.
  try {
    const nodes = doc.querySelectorAll(".selection-popup");
    for (const el of nodes) {
      if (!isUiElement(el)) continue;
      if (isZutPanel(el)) continue;
      const rect = el.getBoundingClientRect();
      if (isVisibleBarRect(rect)) return el;
    }
  } catch {
    // ignore
  }
  return null;
}

export class TranslationPopup {
  private readonly controllers = new Set<AbortController>();
  private panel?: HTMLElement;

  private detachPanel(): void {
    const panel = this.panel;
    if (!panel) return;
    const cleanup = (panel as HTMLElement & { _zutCleanup?: () => void })._zutCleanup;
    cleanup?.();
    panel.remove();
    this.panel = undefined;
  }

  show(selection: ReaderSelection, actions: TranslationPopupActions): void {
    const document = selection.doc;
    ensureStyles(document);
    this.detachPanel();

    const container = document.createElement("div");
    container.setAttribute("role", "status");
    container.dataset.zutPopup = "true";
    this.panel = container;
    Object.assign(container.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      boxSizing: "border-box",
      // Fixed card docked under Zotero's native annotation bar.
      position: "fixed",
      zIndex: "2147483000",
      width: `min(${PANEL_WIDTH}px, calc(100vw - 24px))`,
      minWidth: "240px",
      maxWidth: "calc(100vw - 24px)",
      maxHeight: "min(48vh, 420px)",
      margin: "0",
      padding: "8px 10px",
      border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
      borderRadius: "10px",
      background: "color-mix(in srgb, Canvas 96%, CanvasText 4%)",
      color: "CanvasText",
      boxShadow: "0 12px 32px rgb(0 0 0 / 24%), 0 2px 4px rgb(0 0 0 / 10%)",
      font: "12.5px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif",
      overflow: "hidden",
      pointerEvents: "auto",
      top: "0px",
      left: "0px",
    });

    const statusRow = document.createElement("div");
    Object.assign(statusRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      minHeight: "14px",
      flex: "0 0 auto",
    });
    const spinner = document.createElement("div");
    spinner.className = "zut-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const statusDot = document.createElement("div");
    statusDot.className = "zut-status-dot";
    statusDot.dataset.state = "busy";
    statusDot.hidden = true;
    const status = document.createElement("div");
    status.textContent = "翻译中 · 0.0s";
    Object.assign(status.style, {
      flex: "1 1 auto",
      opacity: "0.85",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontSize: "11px",
      minWidth: "0",
    });
    statusRow.append(spinner, statusDot, status);

    const progress = document.createElement("div");
    progress.className = "zut-progress";
    progress.setAttribute("aria-hidden", "true");
    Object.assign(progress.style, { flex: "0 0 auto" });

    const result = document.createElement("div");
    result.className = "zut-result";
    result.hidden = true;
    Object.assign(result.style, {
      flex: "1 1 auto",
      minHeight: "0",
      maxHeight: RESULT_MAX,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "4px 5px",
      border: "1px solid color-mix(in srgb, currentColor 10%, transparent)",
      borderRadius: "6px",
      background: "color-mix(in srgb, currentColor 3%, transparent)",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      lineHeight: "1.5",
      fontSize: "12px",
    });

    const actionsRow = document.createElement("div");
    actionsRow.hidden = true;
    Object.assign(actionsRow.style, {
      display: "flex",
      gap: "4px",
      alignItems: "center",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      flex: "0 0 auto",
      paddingTop: "2px",
      borderTop: "1px solid color-mix(in srgb, currentColor 8%, transparent)",
    });
    const copy = button(document, "复制", "primary");
    const save = button(document, "注释", "secondary");
    const retry = button(document, "重试", "ghost");
    applyDisabled(copy, true);
    applyDisabled(save, true);
    save.hidden = !actions.save;
    retry.hidden = true;
    actionsRow.append(copy, save, retry);
    container.append(statusRow, progress, result, actionsRow);

    /**
     * Dock the panel as a separate card directly under Zotero's native
     * annotation bar (`.selection-popup`). The bar itself is only ~198px
     * wide, so we must not mount a large panel inside it — instead we
     * mount on the reader document and keep syncing coordinates.
     */
    container.dataset.zutMounted = "dock";
    const host = document.body || document.documentElement;
    host.appendChild(container);

    let cachedBar: HTMLElement | null = null;
    let sawNativeBar = false;
    let recentPointerOnPanel = false;
    const graceUntil = Date.now() + 500;

    const resolveBar = (): HTMLElement | null => {
      if (cachedBar && (!cachedBar.isConnected || !isBarOnScreen(document, cachedBar))) {
        cachedBar = null;
      }
      if (!cachedBar) {
        const found = findNativeSelectionPopup(document);
        if (found && isBarOnScreen(document, found)) cachedBar = found;
      }
      return cachedBar;
    };

    const shouldAutoClose = (): boolean => {
      if (!container.isConnected) return false;
      if (recentPointerOnPanel) return false;
      const native = resolveBar();
      if (native) {
        sawNativeBar = true;
        return false;
      }
      // Bar gone or scrolled off-screen. Close immediately — never park in the center.
      if (sawNativeBar) return true;
      // Still in the open grace window before the bar has mounted.
      if (Date.now() < graceUntil) return false;
      return true;
    };

    const placePanel = (): void => {
      if (!container.isConnected) return;
      const native = resolveBar();
      if (!native) {
        // No on-screen bar: do not reposition (avoids a jump to screen center).
        return;
      }
      sawNativeBar = true;
      const viewW = document.defaultView?.innerWidth || 900;
      const viewH = document.defaultView?.innerHeight || 700;
      const box = container.getBoundingClientRect();
      const width = box.width || PANEL_WIDTH;
      const height = box.height || 100;
      const rect = native.getBoundingClientRect();
      let left = Math.min(Math.max(12, rect.left), Math.max(12, viewW - width - 12));
      let top = rect.bottom + 6;
      const maxTop = Math.max(12, viewH - Math.min(height, viewH * 0.48) - 12);
      top = Math.min(Math.max(12, top), maxTop);
      container.style.left = `${Math.round(left)}px`;
      container.style.top = `${Math.round(top)}px`;
    };

    const syncOnce = (): void => {
      if (!container.isConnected) return;
      if (shouldAutoClose()) {
        this.detachPanel();
        return;
      }
      placePanel();
    };

    syncOnce();
    const raf = document.defaultView?.requestAnimationFrame?.bind(document.defaultView);
    if (raf) {
      raf(() => syncOnce());
      raf(() => raf(() => syncOnce()));
    }
    setTimeout(syncOnce, 60);
    setTimeout(syncOnce, 150);
    setTimeout(syncOnce, 400);

    // Glue to the bar while scrolling; close as soon as it leaves the viewport.
    const syncTimer = setInterval(syncOnce, 100);
    (syncTimer as unknown as { unref?: () => void }).unref?.();
    const onViewportChange = (): void => {
      syncOnce();
    };
    const onSelectionChange = (): void => {
      syncOnce();
    };
    document.defaultView?.addEventListener("resize", onViewportChange);
    document.defaultView?.addEventListener("scroll", onViewportChange, true);
    document.addEventListener("selectionchange", onSelectionChange);

    const markPanelInteraction = (): void => {
      recentPointerOnPanel = true;
      setTimeout(() => {
        recentPointerOnPanel = false;
      }, 350);
    };
    container.addEventListener("pointerdown", markPanelInteraction);
    container.addEventListener("click", markPanelInteraction);

    const closeFromOutside = (): void => {
      this.detachPanel();
    };
    const onDocPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || container.contains(target)) return;
      // Keep open only when clicking the live annotation bar itself.
      const native = resolveBar();
      if (native && native.contains(target)) return;
      closeFromOutside();
    };
    const onKeyDown = (event: Event) => {
      if ((event as KeyboardEvent).key === "Escape") closeFromOutside();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // Clicks in the Zotero chrome (outside the reader iframe) never reach
    // this document — watch the main window too.
    const mainWin = (document.defaultView as Window | null)?.top ?? null;
    const onMainPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || container.contains(target)) return;
      // If the click landed inside this reader document, the iframe handler runs.
      if (target.ownerDocument === document) return;
      closeFromOutside();
    };
    mainWin?.addEventListener("pointerdown", onMainPointerDown, true);
    (container as HTMLElement & { _zutCleanup?: () => void })._zutCleanup = () => {
      clearInterval(syncTimer);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      container.removeEventListener("pointerdown", markPanelInteraction);
      container.removeEventListener("click", markPanelInteraction);
      document.defaultView?.removeEventListener("resize", onViewportChange);
      document.defaultView?.removeEventListener("scroll", onViewportChange, true);
      mainWin?.removeEventListener("pointerdown", onMainPointerDown, true);
    };

    let latestResult: TranslationResult | undefined;
    let controller: AbortController | undefined;

    const setBusy = (busy: boolean) => {
      spinner.hidden = !busy;
      progress.hidden = !busy;
      statusDot.hidden = busy;
      applyDisabled(copy, busy || !latestResult);
      applyDisabled(save, busy || !latestResult || !actions.save);
      applyDisabled(retry, busy);
      statusDot.dataset.state = latestResult ? "done" : "error";
      // Keep the action row visible once a result (or error) exists so
      // 复制/注释/重试 stay reachable.
      actionsRow.hidden = busy && !latestResult && retry.hidden;
    };

    const run = async () => {
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      this.controllers.add(currentController);
      latestResult = undefined;
      result.hidden = true;
      result.textContent = "";
      retry.hidden = true;
      setBusy(true);
      const startedAt = Date.now();
      let progressMessage = "翻译中";
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
        result.hidden = false;
        status.textContent = latestResult.model
          ? `完成 · ${latestResult.model} · ${elapsed()}`
          : `完成 · ${elapsed()}`;
        setBusy(false);
        requestAnimationFrameSafe(document, () => {
          placePanel();
        });
        setTimeout(placePanel, 30);
        setTimeout(placePanel, 120);
      } catch (error) {
        if (currentController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        const message = error instanceof Error ? error.message : "翻译失败";
        result.textContent = message;
        result.hidden = false;
        status.textContent = "失败";
        retry.hidden = false;
        setBusy(false);
        placePanel();
      } finally {
        clearInterval(elapsedTimer);
        this.controllers.delete(currentController);
      }
    };

    copy.addEventListener("click", () => {
      if (!latestResult) return;
      applyDisabled(copy, true);
      void copyText(document, latestResult.text)
        .then(() => {
          status.textContent = "已复制到剪贴板";
          applyDisabled(copy, false);
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : "复制失败";
          applyDisabled(copy, false);
        });
    });
    save.addEventListener("click", () => {
      if (!latestResult || !actions.save) return;
      applyDisabled(save, true);
      status.textContent = "正在保存注释…";
      void actions
        .save(latestResult)
        .then((created) => {
          status.textContent = created ? "已保存到注释" : "注释中已有相同译文";
          // Allow another save after a duplicate (user may retry translation first).
          if (!created) applyDisabled(save, false);
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : "保存失败";
          applyDisabled(save, false);
        });
    });
    retry.addEventListener("click", () => {
      applyDisabled(retry, true);
      void run();
    });

    void run();
  }

  dispose(): void {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
    this.detachPanel();
  }
}

function requestAnimationFrameSafe(document: Document, fn: () => void): void {
  const raf = document.defaultView?.requestAnimationFrame?.bind(document.defaultView);
  if (raf) raf(() => fn());
  else fn();
}
