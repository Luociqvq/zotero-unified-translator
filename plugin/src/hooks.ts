import { addon } from "./index.js";

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  addon.activate();
  await Zotero.PreferencePanes.register({
    pluginID: "zotero-unified-translator@zut.dev",
    id: "zut-preferences",
    label: "Zotero Unified Translator",
    src: `${rootURI}content/preferences.xhtml`,
  });
  for (const window of Zotero.getMainWindows()) {
    await onMainWindowLoad(window);
  }
  addon.data.initialized = true;
}

async function onMainWindowLoad(window: Window): Promise<void> {
  addon.attachMainWindow(window);
}

async function onMainWindowUnload(window: Window): Promise<void> {
  addon.detachMainWindow(window);
}

function onShutdown(): void {
  Zotero.PreferencePanes.unregister("zut-preferences");
  addon.deactivate();
  addon.data.alive = false;
  delete Zotero.ZoteroUnifiedTranslator;
}

async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: Record<string, unknown>,
): Promise<void> {}

async function onPrefsEvent(type: string, data: { window: Window }): Promise<void> {
  if (type === "load") {
    addon.attachPreferences(data.window);
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
