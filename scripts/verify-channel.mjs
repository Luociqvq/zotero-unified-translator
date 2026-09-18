#!/usr/bin/env node
// End-to-end check of the *live* update channel, from the public internet.
//
// scripts/verify-updates.mjs answers "is the manifest in git consistent with
// the artifact in git?". This answers a different question: "is what a client
// actually downloads correct right now?" It follows the manifest the way Zotero
// does, so a vhost pointing at the wrong root, a stale CDN copy or a missing
// artifact fails here rather than in a user's browser.
//
// It reads the artifact path out of the manifest instead of hardcoding it.
// An earlier throwaway version of this check pinned the 1.0.1 filename and
// reported a hash mismatch that turned out to be its own bug, not the server's.
//
//   node scripts/verify-channel.mjs
//   node scripts/verify-channel.mjs --domain zut.eieu.cn --expect-version 1.0.2
//
// Exit code 0 means every check passed.

import https from 'node:https';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}

const DOMAIN = arg('domain', 'zut.eieu.cn');
const EXPECT_VERSION = arg('expect-version', '');
const ARTIFACT = 'zotero-unified-translator.xpi';
const repoRoot = path.resolve(import.meta.dirname, '..');
const localArtifact = path.join(repoRoot, 'release', ARTIFACT);

let failures = 0;
let warnings = 0;

function ok(msg) {
  console.log(`  ok    ${msg}`);
}
function fail(msg) {
  failures++;
  console.log(`  FAIL  ${msg}`);
}
function warn(msg) {
  warnings++;
  console.log(`  warn  ${msg}`);
}
function heading(msg) {
  console.log(`\n== ${msg} ==`);
}

function request(url, { method = 'GET', timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, timeout, headers: { Connection: 'close', 'Cache-Control': 'no-cache' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            cert: res.socket.getPeerCertificate(),
          })
        );
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ------------------------------------------------------------------ manifest
heading(`manifest  https://${DOMAIN}/updates.json`);

let manifest;
try {
  manifest = await request(`https://${DOMAIN}/updates.json`);
} catch (e) {
  fail(`could not fetch the manifest: ${e.code || e.message}`);
  process.exit(1);
}

if (manifest.status === 200) ok(`HTTP 200, ${manifest.body.length} bytes`);
else fail(`expected HTTP 200, got ${manifest.status}`);

const cacheControl = manifest.headers['cache-control'] || '';
if (/no-cache|no-store/.test(cacheControl)) {
  ok(`Cache-Control: ${cacheControl}`);
} else {
  fail(
    `Cache-Control is "${cacheControl || '(absent)'}". A cached manifest makes Zotero ` +
      'treat the installed version as the latest and silently stop offering updates.'
  );
}

// Zotero compares versions numerically component by component, so do the same.
// Joining the parts into one integer gets "1.0.10" vs "1.1.0" backwards.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

let entry;
try {
  const doc = JSON.parse(manifest.body.toString('utf8'));
  const id = Object.keys(doc.addons || {})[0];
  if (!id) throw new Error('manifest has no addons');
  const updates = (doc.addons[id].updates || []).filter((u) => u && u.version);
  if (!updates.length) throw new Error('manifest has no versioned updates');
  updates.sort((a, b) => compareVersions(a.version, b.version));
  entry = updates[updates.length - 1];
  ok(`addon ${id}, newest version ${entry.version}`);
} catch (e) {
  fail(`could not parse the manifest: ${e.message}`);
  process.exit(1);
}

if (EXPECT_VERSION) {
  if (entry.version === EXPECT_VERSION) ok(`version is ${EXPECT_VERSION}, as expected`);
  else fail(`manifest publishes ${entry.version}, but ${EXPECT_VERSION} was expected`);
}

if (!entry.applications?.zotero) {
  fail('entry has no applications.zotero object; Zotero skips such entries entirely');
} else {
  const z = entry.applications.zotero;
  ok(`host range ${z.strict_min_version || '?'} – ${z.strict_max_version || '?'}`);
}

// ------------------------------------------------------------------ artifact
const link = entry.update_link || '';
heading(`artifact  ${link || '(none)'}`);

let linkUrl = null;
if (!link) {
  fail('entry has no update_link, so there is nothing for a client to download');
} else {
  try {
    linkUrl = new URL(link);
  } catch {
    fail(`update_link is not a valid URL: ${link}`);
  }
  if (linkUrl) {
    if (linkUrl.protocol === 'https:') ok('update_link is HTTPS');
    else fail(`update_link must be HTTPS, got ${linkUrl.protocol}`);

    if (linkUrl.host === DOMAIN) ok(`served by ${DOMAIN}`);
    else warn(`update_link points at ${linkUrl.host}, not ${DOMAIN} — intended?`);

    if (path.basename(linkUrl.pathname) === ARTIFACT) {
      warn(
        'artifact uses the mutable filename; a cached copy of an older build can ' +
          'fail the hash check. Prefer a version-pinned name.'
      );
    }
  }
}

let servedBytes = null;
if (linkUrl) {
  try {
    const res = await request(linkUrl.href);
    servedBytes = res.body;
    if (res.status === 200) ok(`HTTP 200, ${res.body.length} bytes`);
    else fail(`expected HTTP 200, got ${res.status}`);

    const type = res.headers['content-type'] || '';
    if (/x-xpinstall|octet-stream|zip/.test(type)) ok(`Content-Type: ${type}`);
    else warn(`Content-Type is "${type || '(absent)'}" (Zotero does not strictly require it)`);
  } catch (e) {
    fail(`could not download the artifact: ${e.code || e.message}`);
  }
}

if (servedBytes && entry.update_hash) {
  const servedSum = sha256(servedBytes);
  if (`sha256:${servedSum}` === entry.update_hash) ok(`sha256 matches update_hash (${servedSum.slice(0, 16)}…)`);
  else
    fail(
      `sha256 mismatch — Zotero would reject this download\n` +
        `         manifest: ${entry.update_hash}\n` +
        `         download: sha256:${servedSum}`
    );
}

// -------------------------------------------------------------------- TLS
heading('TLS');
if (manifest.cert?.subject) {
  ok(`issuer ${manifest.cert.issuer?.O || '?'}, subject ${manifest.cert.subject.CN}`);
  const validTo = new Date(manifest.cert.valid_to);
  const daysLeft = Math.round((validTo - Date.now()) / 86400000);
  if (daysLeft < 0) fail(`certificate expired on ${manifest.cert.valid_to}`);
  else if (daysLeft < 14) warn(`certificate expires in ${daysLeft} days (${manifest.cert.valid_to})`);
  else ok(`valid for another ${daysLeft} days (until ${manifest.cert.valid_to})`);
} else {
  warn('could not read the peer certificate');
}

// ------------------------------------------------- compare with the checkout
heading('cross-check against this checkout');
if (servedBytes && existsSync(localArtifact)) {
  const localBytes = readFileSync(localArtifact);
  if (Buffer.compare(localBytes, servedBytes) === 0) {
    ok(`release/${ARTIFACT} is byte-identical to what the channel serves`);
  } else {
    // Not a hard failure: verifying from an older checkout than the one that is
    // live is legitimate. Report both digests so it is obvious which side is
    // ahead, and let scripts/verify-updates.mjs be the authority on whether the
    // checkout and its own manifest agree.
    warn(
      `release/${ARTIFACT} differs from what the channel serves ` +
        `(local ${localBytes.length}B/${sha256(localBytes).slice(0, 16)}…, ` +
        `served ${servedBytes.length}B/${sha256(servedBytes).slice(0, 16)}…). ` +
        'Expected while the channel is ahead of this checkout; if they should ' +
        'match, the deploy published something other than the build in release/.'
    );
  }
} else {
  warn(`no local release/${ARTIFACT} to compare against`);
}

// ------------------------------------------------------------------ summary
console.log('');
if (failures === 0) {
  console.log(`channel verified: ${DOMAIN} serves ${entry.version} correctly` +
    (warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''));
  process.exit(0);
}
console.log(`channel verification FAILED: ${failures} problem${failures === 1 ? '' : 's'}`);
process.exit(1);
