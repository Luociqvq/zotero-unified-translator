import type { LanguageCode } from "../../contracts/translation.js";

export const PLUGIN_ID = "zotero-unified-translator@zut.dev";

export interface ReaderSelection {
  reader: _ZoteroTypes.ReaderInstance;
  doc: Document;
  annotation: _ZoteroTypes.Annotations.AnnotationJson;
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: Exclude<LanguageCode, "auto">;
  append: _ZoteroTypes.Reader.ReaderAppendType["appendDOM"];
}

export type SelectionHandler = (selection: ReaderSelection) => void;

export type ReaderContextMenuCommand = (
  reader: _ZoteroTypes.ReaderInstance,
) => void | Promise<void>;

function normalizeText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/-\s*\n\s*(?=[a-z])/gi, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Connects the plugin to Zotero 10's public Reader event API. */
export class ReaderBridge {
  private handler?: SelectionHandler;
  private contextMenuCommand?: ReaderContextMenuCommand;
  private registered = false;
  private contextMenusRegistered = false;

  private readonly listener: _ZoteroTypes.Reader.EventHandler<
    "renderTextSelectionPopup"
  > = ({ reader, doc, params, append }) => {
    if (reader.type !== "pdf") return;
    const text = normalizeText(params.annotation.text ?? "");
    if (!text || !this.handler) {
      return;
    }
    this.handler({
      reader,
      doc,
      annotation: params.annotation,
      text,
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      append,
    });
  };

  private readonly viewContextMenuListener: _ZoteroTypes.Reader.EventHandler<
    "createViewContextMenu"
  > = ({ reader, append }) => {
    this.appendFullTranslationMenu(reader, append);
  };

  private readonly selectorContextMenuListener: _ZoteroTypes.Reader.EventHandler<
    "createSelectorContextMenu"
  > = ({ reader, append }) => {
    this.appendFullTranslationMenu(reader, append);
  };

  private appendFullTranslationMenu(
    reader: _ZoteroTypes.ReaderInstance,
    append: _ZoteroTypes.Reader.ReaderAppendType["appendMenu"],
  ): void {
    if (reader.type !== "pdf" || !this.contextMenuCommand) {
      return;
    }
    const itemID =
      typeof reader.itemID === "number" ? reader.itemID : reader._item?.id;
    append({
      label: Zotero.locale.startsWith("zh")
        ? "翻译整篇 PDF"
        : "Translate full PDF",
      disabled: typeof itemID !== "number",
      onCommand: () => {
        if (typeof itemID === "number") {
          void this.contextMenuCommand?.(reader);
        }
      },
    });
  }

  onSelection(handler: SelectionHandler): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = undefined;
      }
    };
  }

  register(contextMenuCommand?: ReaderContextMenuCommand): boolean {
    if (this.registered) {
      return true;
    }
    if (!Zotero.Reader?.registerEventListener) {
      return false;
    }
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      this.listener,
      PLUGIN_ID,
    );
    this.contextMenuCommand = contextMenuCommand;
    if (contextMenuCommand) {
      Zotero.Reader.registerEventListener(
        "createViewContextMenu",
        this.viewContextMenuListener,
        PLUGIN_ID,
      );
      Zotero.Reader.registerEventListener(
        "createSelectorContextMenu",
        this.selectorContextMenuListener,
        PLUGIN_ID,
      );
      this.contextMenusRegistered = true;
    }
    this.registered = true;
    return true;
  }

  dispose(): void {
    if (this.registered && Zotero.Reader?.unregisterEventListener) {
      Zotero.Reader.unregisterEventListener(
        "renderTextSelectionPopup",
        this.listener,
      );
      if (this.contextMenusRegistered) {
        Zotero.Reader.unregisterEventListener(
          "createViewContextMenu",
          this.viewContextMenuListener,
        );
        Zotero.Reader.unregisterEventListener(
          "createSelectorContextMenu",
          this.selectorContextMenuListener,
        );
      }
    }
    this.registered = false;
    this.contextMenusRegistered = false;
    this.contextMenuCommand = undefined;
    this.handler = undefined;
  }
}
