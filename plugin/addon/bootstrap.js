var chromeHandle;

function install(data, reason) {}

async function startup({ rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  await Zotero.uiReadyPromise;
  const win = Zotero.getMainWindow();
  const ctx = {
    rootURI, Zotero, Services, Components, APP_SHUTDOWN,
    fetch, Blob, crypto, TextEncoder, TextDecoder, URL, URLSearchParams,
    IOUtils, setTimeout, clearTimeout, setInterval, clearInterval,
    FormData: win.FormData, AbortController: win.AbortController,
    DOMException: win.DOMException,
  };
  ctx.globalThis = ctx;
  ctx._globalThis = ctx;
  Services.scriptloader.loadSubScript(
    rootURI + "content/scripts/zut.js",
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  await Zotero.__addonInstance__?.hooks.onShutdown();
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
