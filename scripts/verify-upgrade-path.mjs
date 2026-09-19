#!/usr/bin/env node
// End-to-end proof that an already-installed build can actually reach the
// newest release, following the upgrade path exactly as Zotero walks it.
//
// scripts/verify-updates.mjs checks the checkout against its own manifest.
// scripts/verify-channel.mjs checks what the domain serves right now.
// This one starts from an *installed* XPI and asks: would Zotero upgrade it?
// That is a different question, because the update_url is baked into the
// installed build and cannot be fixed after the fact. A shipped 1.0.1 pointing
// at a dead or frozen URL is only visible from here.
//
//   node scripts/verify-upgrade-path.mjs --xpi /tmp/zut-1.0.1.xpi
//   node scripts/verify-upgrade-path.mjs --xpi release/zotero-unified-translator.xpi --expect-version 1.0.2
//   node scripts/verify-upgrade-path.mjs --xpi /tmp/zut-1.0.1.xpi --zotero-version 10.0.5
//
// Checks performed, in the order Zotero performs them:
//   1. the installed build's manifest.json has an update_url
//   2. that URL is reachable and returns a parseable manifest
//   3. the manifest offers a version newer than the installed one
//   4. the entry's applications.zotero range is well-formed, and — when
//      --zotero-version is given — admits that host version (Zotero drops
//      out-of-range entries silently, so this is worth asserting)
//   5. update_hash matches the bytes actually served
//   6. the downloaded archive's own manifest.json agrees with the advertised
//      version — catches a manifest published ahead of a stale artifact
//
// Exit code 0 means the upgrade path works.

import https from 'node:https';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}

const XPI = arg('xpi', '');
const EXPECT_VERSION = arg('expect-version', '');
const ZOTERO_VERSION = arg('zotero-version', '');

let failures = 0;
let warnings = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const warn = (m) => {
  warnings++;
  console.log(`  warn  ${m}`);
};
const heading = (m) => console.log(`\n== ${m} ==`);

// --------------------------------------------------------------- helpers

// Minimal ZIP reader. Both XPI and CRX-style jars are plain ZIPs; walking the
// local file headers avoids taking a dependency just to read one manifest.
function readZip(buffer) {
  const entries = new Map();
  let off = 0;
  while (off + 30 <= buffer.length && buffer.readUInt32LE(off) === 0x04034b50) {
    const method = buffer.readUInt16LE(off + 8);
    const compSize = buffer.readUInt32LE(off + 18);
    const nameLen = buffer.readUInt16LE(off + 26);
    const extraLen = buffer.readUInt16LE(off + 28);
    const name = buffer.slice(off + 30, off + 30 + nameLen).toString('utf8');
    const start = off + 30 + nameLen + extraLen;
    const raw = buffer.slice(start, start + compSize);
    let text = null;
    try {
      text = (method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
    } catch {
      text = null; // binary payload (icons); not needed here
    }
    entries.set(name, text);
    off = start + compSize;
  }
  return entries;
}

function manifestOf(buffer, label) {
  const entries = readZip(buffer);
  const text = entries.get('manifest.json');
  if (!text) throw new Error(`${label} has no manifest.json (${entries.size} entries read)`);
  return { manifest: JSON.parse(text), entryCount: entries.size };
}

function requestOnce(url, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', timeout, headers: { Connection: 'close', 'Cache-Control': 'no-cache' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Transient resets happen often enough on this network that a single attempt
// makes the check unreliable, and an unreliable check gets ignored. Retry the
// network-level failures only; an HTTP status is an answer, not an accident.
const TRANSIENT = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'socket hang up']);

async function request(url, { attempts = 3, label = url } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await requestOnce(url);
    } catch (e) {
      last = e;
      const code = e.code || e.message;
      if (!TRANSIENT.has(code) || attempt === attempts) break;
      console.log(`  ...   ${label}: ${code}, retrying (${attempt}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw last;
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// An installable manifest can carry its host metadata in two places: the
// Firefox-era `browser_specific_settings.gecko` object, or the Zotero-era
// `applications.zotero`. Real shipped builds here use the latter, so read both
// rather than assuming one and reporting a missing update_url that is present.
function readHostBlock(manifest) {
  const gecko = manifest.browser_specific_settings?.gecko || {};
  const zotero = manifest.applications?.zotero || {};
  return {
    id: gecko.id || zotero.id || '',
    updateUrl: gecko.update_url || zotero.update_url || '',
    minVersion: gecko.strict_min_version || zotero.strict_min_version || '',
    maxVersion: gecko.strict_max_version || zotero.strict_max_version || '',
  };
}

// Component-wise, because "1.0.10" vs "1.1.0" compares wrongly as a number.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Firefox/Zotero ranges. Note what these actually constrain: the *host*
// application version (Zotero 10.0.x), never the addon version. Comparing an
// addon version against them is meaningless and reports false failures.
function satisfiesMin(appVersion, min) {
  if (!min || min === '*') return true;
  return compareVersions(appVersion, min.replace(/\.\*$/, '')) >= 0;
}

function satisfiesMax(appVersion, max) {
  if (!max || max === '*') return true;
  if (max.endsWith('.*')) {
    const prefix = max.slice(0, -2).split('.').map(Number);
    const app = String(appVersion).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < prefix.length; i++) {
      if (Number.isNaN(prefix[i])) return true;
      if ((app[i] ?? 0) !== prefix[i]) return false;
    }
    return true;
  }
  return compareVersions(appVersion, max) <= 0;
}

// ------------------------------------------------------- 1. installed build
if (!XPI) {
  console.error('usage: node scripts/verify-upgrade-path.mjs --xpi <installed-build.xpi> [--expect-version 1.0.2]');
  process.exit(2);
}

const xpiPath = path.resolve(XPI);
heading(`installed build  ${xpiPath}`);

let installed;
try {
  installed = manifestOf(readFileSync(xpiPath), path.basename(xpiPath));
} catch (e) {
  fail(`could not read the installed build: ${e.message}`);
  process.exit(1);
}

const installedVersion = installed.manifest.version;
const host = readHostBlock(installed.manifest);
const addonId = host.id;
if (installedVersion) ok(`installed version ${installedVersion}`);
else {
  fail('the installed build has no version');
  process.exit(1);
}
if (addonId) ok(`addon id ${addonId}`);
else {
  fail('the installed build declares no addon id (applications.zotero.id / gecko.id)');
  process.exit(1);
}

const updateUrl = host.updateUrl;
if (!updateUrl) {
  fail(
    'the installed build has no update_url baked in, so it can never discover a ' +
      'newer release. It is pinned to whatever version the user installed.'
  );
  process.exit(1);
}
ok(`update_url ${updateUrl}`);

// ---------------------------------------------------------- 2. the manifest
heading(`manifest  ${updateUrl}`);

// raw.githubusercontent.com answers with text/plain; Zotero overrides the MIME
// type before parsing, so this is fine — but note it, because a proxy that
// rewrites or blocks text/plain would break the channel silently.
let manifestRes;
try {
  manifestRes = await request(updateUrl);
} catch (e) {
  fail(`could not fetch the manifest: ${e.code || e.message}`);
  process.exit(1);
}

if (manifestRes.status === 200) ok(`HTTP ${manifestRes.status}, ${manifestRes.body.length} bytes`);
else fail(`expected HTTP 200, got ${manifestRes.status}`);

const ct = manifestRes.headers['content-type'] || '(absent)';
if (/text\/plain|application\/json/.test(ct)) ok(`Content-Type: ${ct}`);
else warn(`Content-Type is "${ct}"`);

const cacheControl = manifestRes.headers['cache-control'] || '(absent)';
if (/no-cache|no-store|max-age=0/.test(cacheControl)) ok(`Cache-Control: ${cacheControl}`);
else warn(`Cache-Control is "${cacheControl}" — a long-lived CDN copy can pin clients to an old manifest`);

let entry;
let updates;
try {
  const doc = JSON.parse(manifestRes.body.toString('utf8'));
  const addons = doc.addons || {};
  if (!addons[addonId]) throw new Error(`manifest has no entry for ${addonId}`);
  updates = (addons[addonId].updates || []).filter((u) => u && u.version);
  if (!updates.length) throw new Error('manifest has no versioned updates');
  updates.sort((a, b) => compareVersions(a.version, b.version));
  entry = updates[updates.length - 1];
  ok(`manifest lists ${updates.length} update(s); newest is ${entry.version}`);
} catch (e) {
  fail(`could not parse the manifest: ${e.message}`);
  process.exit(1);
}

// ------------------------------------------------- 3. is an upgrade offered?
heading('upgrade decision');

const cmp = compareVersions(entry.version, installedVersion);
if (cmp > 0) {
  ok(`${entry.version} is newer than ${installedVersion} — Zotero will offer the upgrade`);
} else if (cmp === 0) {
  ok(`${installedVersion} is already the newest published version — nothing to upgrade`);
} else {
  fail(
    `manifest publishes ${entry.version}, which is *older* than the installed ` +
      `${installedVersion}. Every client on ${installedVersion} is stranded.`
  );
}

if (EXPECT_VERSION) {
  if (entry.version === EXPECT_VERSION) ok(`newest version is ${EXPECT_VERSION}, as expected`);
  else fail(`expected the manifest to reach ${EXPECT_VERSION}, found ${entry.version}`);
}

// ------------------------------------------------------ 4. host compatibility
// Zotero's AddonUpdateChecker drops an entry whose range does not contain the
// running Zotero version, silently. So the range is the difference between an
// update that is offered and one that never appears, with no error anywhere.
heading('host compatibility');
const z = entry.applications?.zotero;
if (!z) {
  fail('entry has no applications.zotero; Zotero skips such entries entirely');
} else {
  const min = z.strict_min_version || '';
  const max = z.strict_max_version || '';
  ok(`range ${min || '?'} – ${max || '?'}`);

  if (min && max && max !== '*' && compareVersions(min.replace(/\.\*$/, ''), max.replace(/\.\*$/, '')) > 0) {
    fail(`range is inverted: min ${min} is above max ${max}, so no host can ever match`);
  } else {
    ok('range is well-formed (min ≤ max)');
  }

  if (ZOTERO_VERSION) {
    if (satisfiesMin(ZOTERO_VERSION, min)) ok(`Zotero ${ZOTERO_VERSION} satisfies strict_min_version ${min || '?'}`);
    else fail(`Zotero ${ZOTERO_VERSION} is below strict_min_version ${min}; the update would be hidden`);

    if (satisfiesMax(ZOTERO_VERSION, max)) ok(`Zotero ${ZOTERO_VERSION} satisfies strict_max_version ${max || '?'}`);
    else
      fail(
        `Zotero ${ZOTERO_VERSION} is outside strict_max_version ${max}; the update would be ` +
          'hidden from every client on a newer host'
      );
  } else {
    warn(
      'host compatibility against a concrete Zotero version not checked — pass ' +
        '--zotero-version 10.0.5 to test the filter Zotero actually applies'
    );
  }
}

// If there is nothing to install, the download leg has nothing to prove.
if (cmp <= 0) {
  console.log('');
  console.log(
    `upgrade path verified: an installed ${installedVersion} build is correctly ` +
      `told that ${entry.version} is the newest release` +
      (warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : '')
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ------------------------------------------------------------ 5. the artifact
const link = entry.update_link || '';
heading(`artifact  ${link || '(none)'}`);

let downloaded = null;
if (!link) {
  fail('entry has no update_link, so there is nothing for Zotero to download');
} else {
  try {
    const u = new URL(link);
    if (u.protocol === 'https:') ok('update_link is HTTPS');
    else fail(`update_link must be HTTPS, got ${u.protocol}`);
  } catch {
    fail(`update_link is not a valid URL: ${link}`);
  }

  try {
    const res = await request(link);
    if (res.status === 200) ok(`HTTP 200, ${res.body.length} bytes`);
    else fail(`expected HTTP 200, got ${res.status}`);
    downloaded = res.body;
  } catch (e) {
    fail(`could not download the artifact: ${e.code || e.message}`);
  }
}

if (downloaded && entry.update_hash) {
  const served = sha256(downloaded);
  if (`sha256:${served}` === entry.update_hash) {
    ok(`sha256 matches update_hash (${served.slice(0, 16)}…)`);
  } else {
    fail(
      'sha256 mismatch — Zotero would refuse this download\n' +
        `         manifest: ${entry.update_hash}\n` +
        `         download: sha256:${served}`
    );
  }
}

// ---------------------------------------- 6. does the archive match the claim?
heading('artifact self-consistency');
if (downloaded) {
  try {
    const artifact = manifestOf(downloaded, 'downloaded artifact');
    if (artifact.manifest.version === entry.version) {
      ok(`archive declares version ${artifact.manifest.version}, matching the manifest`);
    } else {
      fail(
        `the manifest advertises ${entry.version} but the archive declares ` +
          `${artifact.manifest.version}. Clients would install one version and be ` +
          'offered the same update again on every check.'
      );
    }
    const artifactHost = readHostBlock(artifact.manifest);
    if (artifactHost.id === addonId) {
      ok(`archive addon id ${addonId} matches the installed build`);
    } else {
      fail('archive addon id differs from the installed build; the upgrade cannot apply');
    }
    if (artifactHost.updateUrl === updateUrl) {
      ok('archive keeps the same update_url, so the next release is still reachable');
    } else {
      warn(
        `archive changes update_url to "${artifactHost.updateUrl || '(none)'}" ` +
          `(was "${updateUrl}"). Intended migration? If it is dead, this becomes ` +
          'the last release anyone can upgrade from.'
      );
    }
    if (compareVersions(artifact.manifest.version, installedVersion) > 0) {
      ok(`archive ${artifact.manifest.version} > installed ${installedVersion}`);
    } else {
      fail(`archive version ${artifact.manifest.version} does not exceed the installed ${installedVersion}`);
    }
  } catch (e) {
    fail(`could not inspect the downloaded artifact: ${e.message}`);
  }
}

console.log('');
if (failures === 0) {
  console.log(
    `upgrade path verified: ${installedVersion} → ${entry.version}` +
      (warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : '')
  );
  process.exit(0);
}
console.log(`upgrade path FAILED: ${failures} problem${failures === 1 ? '' : 's'}`);
process.exit(1);
