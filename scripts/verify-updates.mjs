// Validate updates.json against the rules Zotero's AddonUpdateChecker actually
// enforces, and cross-check it against the built XPI.
//
// A mismatch here fails silently in production: Zotero just never offers the
// update, so nothing looks broken until users are stuck on an old version.
//
//   node scripts/verify-updates.mjs
//
// Exit code 0 = manifest is publishable, 1 = do not publish.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

// adm-zip lives in the plugin's dependency tree; resolve it from there so this
// script can still be run from the repository root.
const require = createRequire(path.join(repoRoot, 'plugin', 'package.json'));
const AdmZip = require('adm-zip');

const manifestPath = path.join(repoRoot, 'updates.json');
const xpiPath = path.join(repoRoot, 'release', 'zotero-unified-translator.xpi');

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const ok = (msg) => notes.push(msg);

if (!existsSync(manifestPath)) {
  console.error('updates.json not found at ' + manifestPath);
  process.exit(1);
}
if (!existsSync(xpiPath)) {
  console.error('XPI not found at ' + xpiPath + ' (run scripts/package-plugin.ps1 first)');
  process.exit(1);
}

const raw = readFileSync(manifestPath, 'utf8');
let doc;
try {
  doc = JSON.parse(raw);
} catch (e) {
  console.error('updates.json is not valid JSON: ' + e.message);
  process.exit(1);
}

// --- shape checks mirroring parseJSONManifest -------------------------------
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

if (!isObject(doc)) fail('root must be a JSON object');
const addons = isObject(doc) ? doc.addons : undefined;
if (!isObject(addons)) fail('root must have an "addons" object');

// --- read the built XPI -----------------------------------------------------
const xpi = new AdmZip(xpiPath);
const addonManifest = JSON.parse(xpi.readAsText('manifest.json'));
const addonId = addonManifest.applications?.zotero?.id;
const xpiVersion = addonManifest.version;
const xpiSha256 = createHash('sha256').update(readFileSync(xpiPath)).digest('hex');

if (!addonId) fail('XPI manifest has no applications.zotero.id');

const entry = isObject(addons) ? addons[addonId] : undefined;
if (!entry) {
  fail(`"addons" has no entry for the addon id ${addonId}`);
} else {
  const updates = entry.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    fail('entry must have a non-empty "updates" array');
  } else {
    const versions = [];
    for (const [i, u] of updates.entries()) {
      const where = `updates[${i}]`;
      if (!isObject(u)) { fail(`${where} must be an object`); continue; }

      if (typeof u.version !== 'string' || !u.version) {
        fail(`${where}.version is required and must be a string`);
        continue;
      }
      versions.push(u.version);

      // A missing applications.zotero makes Zotero skip the entry entirely.
      if (!isObject(u.applications)) {
        fail(`${where}.applications must be an object`);
      } else if (!isObject(u.applications.zotero)) {
        fail(`${where}.applications.zotero must be an object (without it the entry is skipped)`);
      }

      if (u.update_link !== undefined && typeof u.update_link !== 'string') {
        fail(`${where}.update_link must be a string`);
      }
      if (u.update_hash !== undefined) {
        if (typeof u.update_hash !== 'string') fail(`${where}.update_hash must be a string`);
        else if (!/^sha(256|512):[0-9a-f]+$/.test(u.update_hash.toLowerCase())) {
          fail(`${where}.update_hash must look like "sha256:<hex>"`);
        }
      }
    }

    if (!versions.includes(xpiVersion)) {
      fail(`no update entry matches the built XPI version ${xpiVersion}`);
    }

    // The newest entry is the one Zotero will hand out; verify it points at a
    // real artifact with a matching digest.
    const newest = updates
      .filter((u) => typeof u.version === 'string')
      .sort(compareVersions)
      .pop();

    if (newest) {
      if (newest.version !== xpiVersion) {
        fail(
          `newest entry is ${newest.version} but the built XPI is ${xpiVersion}; ` +
            'rebuild the XPI or fix the entry',
        );
      }
      const expectedName = 'zotero-unified-translator.xpi';
      if (typeof newest.update_link === 'string') {
        if (!newest.update_link.startsWith('https://')) {
          fail('update_link must be HTTPS (Zotero drops non-HTTPS links without a strong hash)');
        }
        // Two supported hosts for the artifact:
        //   GitHub Releases  .../releases/download/v<ver>/zotero-unified-translator.xpi
        //   self-hosted      <https>://<host>/release/zotero-unified-translator-<ver>.xpi
        // The self-hosted form is version-pinned on purpose: an immutable URL can
        // be cached hard without a stale copy ever failing Zotero's hash check.
        const githubRelease = newest.update_link.endsWith(
          `/releases/download/v${newest.version}/${expectedName}`,
        );
        const selfHosted = newest.update_link.endsWith(
          `/release/zotero-unified-translator-${newest.version}.xpi`,
        );
        if (!githubRelease && !selfHosted) {
          fail(
            'update_link must point at either ' +
              `".../releases/download/v${newest.version}/${expectedName}" or ` +
              `".../release/zotero-unified-translator-${newest.version}.xpi"`,
          );
        }
        ok('update_link: ' + newest.update_link);
      } else {
        fail('newest entry has no update_link, so there is nothing to download');
      }

      if (typeof newest.update_hash === 'string') {
        const digest = newest.update_hash.split(':')[1]?.toLowerCase();
        if (digest !== xpiSha256) {
          fail(
            'update_hash does not match the built XPI\n' +
              '           manifest: ' + digest + '\n' +
              '           actual  : ' + xpiSha256,
          );
        } else {
          ok('update_hash matches the built XPI sha256');
        }
      } else {
        fail('newest entry has no update_hash; add one so a corrupted download is rejected');
      }
    }
  }
}

// --- report -----------------------------------------------------------------
console.log('addon id       : ' + addonId);
console.log('xpi version    : ' + xpiVersion);
console.log('xpi size       : ' + readFileSync(xpiPath).length + ' bytes');
console.log('xpi sha256     : ' + xpiSha256);
console.log('');
for (const n of notes) console.log('  ok   ' + n);
for (const p of problems) console.log('  FAIL ' + p);

if (problems.length) {
  console.log('\n' + problems.length + ' problem(s): updates.json is NOT publishable.');
  process.exit(1);
}
console.log('\nupdates.json is consistent with the built XPI.');

// Zotero compares versions numerically, not lexically ("1.0.10" > "1.0.9").
function compareVersions(a, b) {
  const pa = a.version.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.version.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
