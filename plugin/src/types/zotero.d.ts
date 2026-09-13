/// <reference types="zotero-types" />

declare namespace Zotero {
  let ZoteroUnifiedTranslator: unknown;

  const DataObjectUtilities: {
    generateKey(): string;
  };
}

/** Supplied by bootstrap.js when the bundled script is evaluated. */
declare const rootURI: string;
