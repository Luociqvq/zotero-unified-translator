import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';

// Local XPI packaging requires no hosted repository or update server.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const tokens = {
  ...pkg.config,
  updateURL: process.env.ZUT_UPDATE_URL || pkg.config.updateURL,
  buildVersion: pkg.version,
  description: pkg.description,
  author: pkg.author,
};
const destination = path.resolve('.scaffold/build');
const zip = new AdmZip();
function substitute(text) {
  return text.replace(/__([A-Za-z]+)__/g, (match, name) => tokens[name] ?? match);
}
async function assets(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) { await assets(source, relative + '/'); continue; }
    const binary = /\.(?:png|jpg|jpeg|gif|ico|webp)$/i.test(entry.name);
    if (binary) {
      zip.addFile(relative, await readFile(source));
      continue;
    }
    let text = substitute(await readFile(source, 'utf8'));
    let target = relative;
    if (target.endsWith('.ftl')) {
      text = text.replace(/^([a-z][a-z0-9-]*)\s*=/gm, pkg.config.addonRef + '-$1 =');
      target = target.replace(/([^/]+)\.ftl$/, pkg.config.addonRef + '-$1.ftl');
    }
    if (target.endsWith('.xhtml')) {
      text = text.replace(/data-l10n-id="([^"]+)"/g, 'data-l10n-id="' + pkg.config.addonRef + '-$1"');
    }
    if (target === 'prefs.js') text = text.replace(/pref\("/g, 'pref("' + pkg.config.prefsPrefix + '.');
    zip.addFile(target, Buffer.from(text));
  }
}
await assets('addon');
const result = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'iife', target: 'firefox140', write: false });
zip.addFile('content/scripts/zut.js', result.outputFiles[0].contents);
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, pkg.name + '.xpi'), zip.toBuffer());
console.log('Built ' + path.join(destination, pkg.name + '.xpi'));
