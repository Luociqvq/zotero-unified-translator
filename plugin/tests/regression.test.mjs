import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';

async function moduleAt(path) {
  const built = await build({ entryPoints: [path], bundle: true, format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
}

test('XPI startup registers Reader, menu and preferences using its supplied sandbox globals', async () => {
  const zip = new AdmZip('.scaffold/build/zotero-unified-translator.xpi');
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(manifest.version, '0.1.8');
  assert.equal(manifest.author, 'Luoci');
  assert.equal(manifest.applications.zotero.strict_min_version, '10.0.0');
  assert.equal(manifest.applications.zotero.strict_max_version, '10.0.*');
  assert.equal(manifest.applications.zotero.update_url, 'https://updates.zut.invalid/updates.json');
  assert.ok(zip.readFile('content/icons/zut-icon-48.png').length > 100);
  assert.ok(zip.readFile('content/icons/zut-icon-96.png').length > 100);
  const calls = [];
  const win = { FormData, AbortController, DOMException };
  const Zotero = {
    initializationPromise: Promise.resolve(), unlockPromise: Promise.resolve(), uiReadyPromise: Promise.resolve(),
    getMainWindow: () => win, getMainWindows: () => [win],
    locale: 'zh-CN',
    Prefs: { get: () => '' },
    Reader: { registerEventListener: (...args) => calls.push(['reader', ...args]), unregisterEventListener() {} },
    MenuManager: { registerMenu: (opts) => { calls.push(['menu', opts]); return opts.menuID; }, unregisterMenu() {} },
    PreferencePanes: { register: async (opts) => calls.push(['prefs', opts]), unregister() {} },
  };
  const Services = { logins: {}, io: { newURI: value => value }, scriptloader: {
    loadSubScript: (url, ctx) => vm.runInNewContext(zip.readAsText('content/scripts/zut.js'), ctx),
  } };
  const Components = { interfaces: {}, classes: {
    '@mozilla.org/addons/addon-manager-startup;1': { getService: () => ({ registerChrome: () => ({ destruct() {} }) }) },
  } };
  const context = vm.createContext({ Zotero, Services, Components, APP_SHUTDOWN: 99,
    fetch, Blob, crypto, TextEncoder, TextDecoder, URL, URLSearchParams, IOUtils: {},
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(zip.readAsText('bootstrap.js'), context);
  await context.startup({ rootURI: 'resource://zut/' }, 1);
  assert.deepEqual(calls.map(c => c[0]), ['reader', 'reader', 'reader', 'menu', 'prefs']);
  assert.equal(calls[0][1], 'renderTextSelectionPopup');
  assert.equal(calls[1][1], 'createViewContextMenu');
  assert.equal(calls[2][1], 'createSelectorContextMenu');
  const readerMenu = [];
  calls[1][2]({
    reader: { type: 'pdf', itemID: 42 },
    append: menu => readerMenu.push(menu),
  });
  assert.equal(readerMenu.length, 1);
  assert.equal(readerMenu[0].label, '翻译整篇 PDF');
  assert.equal(readerMenu[0].disabled, false);
  const itemMenu = calls[3][1];
  assert.equal(itemMenu.target, 'main/library/item');
  assert.equal(itemMenu.menus[0].menuType, 'submenu');
  assert.equal(itemMenu.menus[0].icon, 'chrome://zut/content/icons/zut-icon-48.png');
  const rootAttributes = {};
  const rootContext = {
    menuElem: { setAttribute: (name, value) => { rootAttributes[name] = value; } },
    setVisible: value => { rootContext.visible = value; },
    setEnabled: value => { rootContext.enabled = value; },
    items: [{}],
  };
  itemMenu.menus[0].onShowing({}, rootContext);
  assert.equal(rootAttributes.label, 'ZUT');
  assert.equal(rootContext.visible, true);
  assert.equal(rootContext.enabled, true);
  const childMenu = itemMenu.menus[0].menus[0];
  const childAttributes = {};
  const childContext = {
    menuElem: { setAttribute: (name, value) => { childAttributes[name] = value; } },
    setEnabled: value => { childContext.enabled = value; },
    items: [{}],
  };
  childMenu.onShowing({}, childContext);
  assert.equal(childAttributes.label, 'ZUT: 翻译 PDF');
  assert.equal(childContext.enabled, true);
  assert.equal(calls[4][1].src, 'resource://zut/content/preferences.xhtml');
  await context.shutdown({ rootURI: 'resource://zut/' }, 2);
  assert.equal(Zotero.ZoteroUnifiedTranslator, undefined);
});

test('credentials use modern three-argument lookup and async write, with in-place updates', async () => {
  const rows = [];
  globalThis.Services = { logins: {
    findLogins: (...args) => { assert.deepEqual(args, ['chrome://zotero-unified-translator', null, 'ZUT credentials']); return rows; },
    addLoginAsync: async value => rows.push(value),
    modifyLogin: (old, value) => rows.splice(rows.indexOf(old), 1, value),
    removeLogin: old => rows.splice(rows.indexOf(old), 1),
  } };
  globalThis.Components = { interfaces: {}, classes: { '@mozilla.org/login-manager/loginInfo;1': {
    createInstance: () => ({ init(host, url, realm, username, password) { Object.assign(this, { username, password }); } }),
  } } };
  const { createCredentialStore } = await moduleAt('src/modules/storage/credentials.ts');
  const store = createCredentialStore();
  await store.set('key', 'test-one');
  await store.set('key', 'test-two');
  assert.equal(rows.length, 1);
  assert.equal(await store.get('key'), 'test-two');
  await store.delete('key');
  assert.equal(rows.length, 0);
});

test('fresh and legacy settings default to the HY-MT1.5-1.8B translation service', async () => {
  const { ConfigStore } = await moduleAt('src/modules/core/config.ts');
  const fresh = new ConfigStore({ get: () => undefined, set: () => {} }).load();
  assert.equal(fresh.schemaVersion, 4);
  assert.equal(fresh.instant.defaultProvider, 'openai-compatible');
  assert.equal(fresh.instant.providers['openai-compatible'].endpoint, 'https://fanyi.eieu.cn/v1');
  assert.equal(fresh.instant.providers['openai-compatible'].model, 'HY-MT1.5-1.8B');
  assert.equal(fresh.full.endpoint, 'https://pdf2zh.eieu.cn');

  const legacy = new ConfigStore({
    get: () => JSON.stringify({
      schemaVersion: 2,
      instant: {
        defaultProvider: 'google-free',
        providers: {
          'openai-compatible': {
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            apiKeyRef: 'instant.openai-compatible.apiKey',
          },
        },
      },
    }),
    set: () => {},
  }).load();
  assert.equal(legacy.instant.defaultProvider, 'openai-compatible');
  assert.equal(legacy.instant.providers['openai-compatible'].endpoint, 'https://fanyi.eieu.cn/v1');
  assert.equal(legacy.instant.providers['openai-compatible'].model, 'HY-MT1.5-1.8B');
});

test('old local full-translation default migrates to the configured remote backend', async () => {
  const { ConfigStore } = await moduleAt('src/modules/core/config.ts');
  const migrated = new ConfigStore({
    get: () => JSON.stringify({
      schemaVersion: 3,
      full: { endpoint: 'http://127.0.0.1:8890' },
    }),
    set: () => {},
  }).load();
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.full.endpoint, 'https://pdf2zh.eieu.cn');

  const customLocal = new ConfigStore({
    get: () => JSON.stringify({
      schemaVersion: 4,
      full: { endpoint: 'http://127.0.0.1:8890' },
    }),
    set: () => {},
  }).load();
  assert.equal(customLocal.full.endpoint, 'http://127.0.0.1:8890');
});

test('OpenAI-compatible nested errors are shown to the user', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { type: 'authentication_error', message: 'A valid Bearer API key is required.' },
    }), { status: 401, headers: { 'content-type': 'application/json' } });
    const { requestJson } = await moduleAt('src/modules/utils/http.ts');
    await assert.rejects(
      requestJson('https://fanyi.eieu.cn/v1/chat/completions'),
      /authentication_error: A valid Bearer API key is required\./,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('PDF bytes survive file reading and writing without text conversion', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 0, 128, 255, 13, 10]);
  const sourceItem = { isPDFAttachment: () => true, getFilePathAsync: async () => 'input.pdf', attachmentFilename: 'input.pdf', libraryID: 1 };
  globalThis.IOUtils = { read: async () => bytes, write: async (path, actual) => assert.deepEqual(actual, bytes) };
  globalThis.Zotero = {
    getTempDirectory: () => ({ clone: () => ({ append() {}, path: 'temp.pdf' }) }),
    Attachments: { importFromFile: async opts => { assert.equal(opts.file, 'temp.pdf'); return { id: 42 }; } },
    File: { removeIfExists: async () => {} },
  };
  const { readPDFSource, importTranslatedPDF } = await moduleAt('src/modules/translation/full/attachment.ts');
  const source = await readPDFSource(sourceItem);
  assert.deepEqual(source.bytes, bytes);
  assert.equal(source.fileHash.length, 64);
  const result = await importTranslatedPDF(source, { taskId: 'test', targetLanguage: 'zh-CN', outputMode: 'bilingual', engine: 'pdf2zh_next' }, new Blob([bytes]));
  assert.equal(result.id, 42);
});

test('saving translation preserves the latest user comment and prevents duplicate saves', async () => {
  const existing = { key: 'ABCDEFGH', parentItemID: 1, annotationComment: 'new user comment', isAnnotation: () => true, isEditable: () => true };
  let count = 0;
  globalThis.Zotero = {
    Items: { getByLibraryAndKey: () => existing },
    Annotations: { toJSON: async () => ({ key: existing.key, comment: existing.annotationComment }), saveFromJSON: async (_, json) => { count++; existing.annotationComment = json.comment; } },
  };
  const { saveTranslationToAnnotation } = await moduleAt('src/modules/translation/instant/annotation.ts');
  const attachment = { id: 1, libraryID: 1, isEditable: () => true };
  const annotation = { key: existing.key, text: 'text', comment: 'stale comment' };
  assert.equal(await saveTranslationToAnnotation(attachment, annotation, 'translation', 'test', 'zh-CN'), true);
  assert.ok(existing.annotationComment.startsWith('new user comment'));
  assert.equal(await saveTranslationToAnnotation(attachment, annotation, 'translation', 'test', 'zh-CN'), false);
  assert.equal(count, 1);
});

test('backend download never sends credentials to a different origin', async () => {
  const { FullTranslationClient } = await moduleAt('src/modules/translation/full/client.ts');
  await assert.rejects(new FullTranslationClient('http://127.0.0.1:8890', 'test').download({ downloadUrl: 'https://other.invalid/file' }));
});

test('XUL controls have Fluent label attributes in both locales', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const ftl = readFileSync(`addon/locale/${locale}/preferences.ftl`, 'utf8');
    for (const name of ['pref-save', 'pref-health-check', 'pref-save-annotation', 'pref-show-progress']) {
      assert.match(ftl, new RegExp(name + ' =\\r?\\n    \\.label ='));
    }
  }
});
