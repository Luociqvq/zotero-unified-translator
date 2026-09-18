#!/usr/bin/env bash
#
# Deploy the Zotero Unified Translator update channel on an XP-Panel host.
#
# Zotero's AddonUpdateChecker only needs a JSON manifest plus the XPI it points
# at, both over HTTPS. There is no server-side logic to run, so this deploys
# nginx static hosting rather than an application — one less service to fall
# over, and nothing to keep in memory.
#
# Everything served is pulled from the GitHub repository and the GitHub release,
# so the repo stays the single source of truth and this script is idempotent.
#
#   sudo bash scripts/deploy-updates.sh --domain zut.eieu.cn
#   sudo bash scripts/deploy-updates.sh --domain zut.eieu.cn --issue-cert
#
# Re-run it after every release: it re-fetches the manifest, installs the new
# XPI under a version-pinned filename, re-verifies the digest and reloads nginx.
#
set -euo pipefail

ARTIFACT="zotero-unified-translator"

DOMAIN="${DOMAIN:-}"
REPO="${REPO:-Luociqvq/zotero-unified-translator}"
REF="${REF:-main}"
WEBROOT="${WEBROOT:-}"
NGINX_BIN="${NGINX_BIN:-/xp/server/nginx/sbin/nginx}"
NGINX_CONF="${NGINX_CONF:-/xp/server/nginx/conf/nginx.conf}"
VHOST_DIR="${VHOST_DIR:-/xp/panel/vhost/nginx}"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/certbot}"
WEB_USER="${WEB_USER:-www}"
LOG_DIR="${LOG_DIR:-/xp/wwwlogs}"
CERT_DIR="${CERT_DIR:-}"
ISSUE_CERT="${ISSUE_CERT:-0}"
EMAIL="${EMAIL:-}"
EXPECT_VERSION="${EXPECT_VERSION:-}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/deploy-updates.sh [options]

  --domain <name>     Domain the update channel is served on (required),
                      e.g. zut.eieu.cn. Also decides the default webroot.
  --repo <owner/name> GitHub repository (default Luociqvq/zotero-unified-translator)
  --ref <ref>         Git ref to pull updates.json and the site from (default main)
  --expect-version <v> Fail unless the fetched manifest publishes exactly <v>.
  --webroot <path>    Document root (default /xp/www/<domain>)
  --cert-dir <path>   Let's Encrypt live dir (default /etc/letsencrypt/live/<domain>)
  --email <address>   Contact address, only used together with --issue-cert
  --issue-cert        Run certbot (webroot) when no certificate exists yet
  -h, --help          Show this help

raw.githubusercontent.com caches by PATH, so a branch ref can keep serving the
pre-push content for a few minutes. Always pass --expect-version together with a
tag or commit SHA ref, otherwise a deploy right after a release can silently
publish the previous version:

  sudo bash scripts/deploy-updates.sh --domain zut.eieu.cn \
       --ref v1.0.2 --expect-version 1.0.2
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)     DOMAIN="${2:-}";   shift 2 ;;
    --repo)       REPO="${2:-}";     shift 2 ;;
    --ref)        REF="${2:-}";      shift 2 ;;
    --expect-version) EXPECT_VERSION="${2:-}"; shift 2 ;;
    --webroot)    WEBROOT="${2:-}";  shift 2 ;;
    --cert-dir)   CERT_DIR="${2:-}"; shift 2 ;;
    --email)      EMAIL="${2:-}";    shift 2 ;;
    --issue-cert) ISSUE_CERT=1;      shift   ;;
    -h|--help)    usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

[ -n "$DOMAIN" ]  || { usage; die "--domain is required"; }
[ -n "$WEBROOT" ] || WEBROOT="/xp/www/${DOMAIN}"
[ -n "$CERT_DIR" ] || CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ -x "$NGINX_BIN" ] || die "nginx binary not found at $NGINX_BIN"

for tool in curl python3 sha256sum install; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool missing: $tool"
done

RAW="https://raw.githubusercontent.com/${REPO}/${REF}"
XPI_URL="https://github.com/${REPO}/releases/download/v__VER__/${ARTIFACT}.xpi"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  # $1 = repo-relative path, $2 = destination
  curl -sSL --fail --retry 3 --retry-delay 2 \
       -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
       -o "$2" "${RAW}/$1" || die "failed to fetch $1 from ${REF}"
}

# Print "<version> <sha256> <update_link>" for the newest entry in a manifest.
# Newest is what Zotero hands out, so it is the only entry worth mirroring.
# Errors go to stderr and are never swallowed: a manifest we cannot parse has to
# stop the deploy, not quietly turn into an empty version string.
manifest_meta() {
  python3 - "$1" <<'PY'
import json, re, sys

with open(sys.argv[1], encoding='utf-8') as fh:
    doc = json.load(fh)

addons = doc.get('addons') or {}
if not addons:
    sys.exit('manifest has no "addons" object')

# Single-addon channel; take the only key rather than hardcoding the id.
entry = addons[sorted(addons)[0]]
updates = [u for u in (entry.get('updates') or [])
           if isinstance(u, dict) and u.get('version')]
if not updates:
    sys.exit('manifest has no versioned update entries')

updates.sort(key=lambda u: [int(n) for n in re.findall(r'\d+', u['version'])])
newest = updates[-1]

print(newest['version'],
      (newest.get('update_hash') or '').split(':')[-1],
      newest.get('update_link') or '')
PY
}

newest_version() {
  manifest_meta "$1" | awk '{print $1}'
}

# --------------------------------------------------------------------- 1. files
log "webroot: ${WEBROOT}"
install -d -m 0755 "$WEBROOT" "$WEBROOT/release"

log "fetching manifest and landing page from ${REPO}@${REF}"
fetch 'updates.json'           "$WEBROOT/updates.json"
fetch 'deploy/site/index.html' "$WEBROOT/index.html"

# ------------------------------------------------------------- 2. read manifest
MANIFEST_META="$(manifest_meta "$WEBROOT/updates.json")" \
  || die "could not parse ${WEBROOT}/updates.json"

read -r VER HASH LINK <<< "$MANIFEST_META"

[ -n "${VER:-}" ]  || die "could not read a version from the manifest"
[ -n "${HASH:-}" ] || die "manifest entry for ${VER} has no update_hash"

# Guard against publishing a stale ref. raw.githubusercontent.com caches by path
# and a branch ref keeps serving the pre-push content for a few minutes, so a
# deploy run right after a release can otherwise fetch the previous manifest and
# quietly redeploy the previous version -- which looks like success.
if [ -n "$EXPECT_VERSION" ] && [ "$VER" != "$EXPECT_VERSION" ]; then
  die "the manifest at ref '${REF}' publishes ${VER}, but ${EXPECT_VERSION} was expected.
     The raw CDN caches by path, so a branch ref is often stale right after a push.
     Re-run with --ref v${EXPECT_VERSION} (or the release commit SHA)."
fi

log "manifest publishes version ${VER}"
log "expected sha256 ${HASH}"

# ------------------------------------------------------------------ 3. artifact
# Always take the bytes from the tagged GitHub release: that is the artifact the
# manifest digest was computed from, so a mismatch here means a broken release.
SRC="${XPI_URL/__VER__/$VER}"
log "downloading ${SRC}"
curl -sSL --fail --retry 3 --retry-delay 2 -o "$TMP/${ARTIFACT}.xpi" "$SRC" \
  || die "failed to download the v${VER} XPI from the GitHub release"

ACTUAL="$(sha256sum "$TMP/${ARTIFACT}.xpi" | awk '{print $1}')"
if [ "$ACTUAL" != "$HASH" ]; then
  die "digest mismatch for v${VER}
       manifest: ${HASH}
       download: ${ACTUAL}
     Zotero would reject this download, so nothing was published."
fi

# Version-pinned name so the URL is immutable and safely cacheable; a stable
# alias sits alongside it for the landing page and manual installs. Serving one
# mutable filename would risk a stale cached copy failing Zotero's hash check.
install -m 0644 "$TMP/${ARTIFACT}.xpi" "$WEBROOT/release/${ARTIFACT}-${VER}.xpi"
ln -sfn "${ARTIFACT}-${VER}.xpi" "$WEBROOT/release/${ARTIFACT}.xpi"

if [ -n "$LINK" ]; then
  log "manifest update_link: ${LINK}"
  case "$LINK" in
    *"${ARTIFACT}-${VER}.xpi"*) ;;
    *) warn "update_link does not end in ${ARTIFACT}-${VER}.xpi — check the manifest points at this host" ;;
  esac
fi

# ------------------------------------------------------------------- 4. perms
# The panel's nginx worker runs as www; these files only need to be readable.
chown -R "${WEB_USER}:${WEB_USER}" "$WEBROOT"
find "$WEBROOT" -type d -exec chmod 0755 {} +
find "$WEBROOT" -type f -exec chmod 0644 {} +

# ------------------------------------------------------------------- 5. vhost
HAS_CERT=0
if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
  HAS_CERT=1
fi

write_vhost() {
  local cert="${CERT_DIR}/fullchain.pem"
  local key="${CERT_DIR}/privkey.pem"
  local conf="${VHOST_DIR}/${DOMAIN}.conf"
  local out="${TMP}/vhost.conf"

  install -d -m 0755 "$VHOST_DIR" "$ACME_WEBROOT"

  # Emitted into both server blocks. A cached manifest silently stops update
  # checks, and from the client that is indistinguishable from "no new version",
  # so this rule must not depend on which branch happens to be generated.
  local manifest_location
  manifest_location=$(cat <<'SNIP'

    # Zotero must never see a cached manifest, or it keeps treating the
    # installed version as the latest and silently never offers an update.
    location = /updates.json {
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Access-Control-Allow-Origin "*" always;
        default_type application/json;
    }
SNIP
)

  cat > "$out" <<EOF
# Generated by scripts/deploy-updates.sh for ${DOMAIN} — do not edit by hand,
# the next deploy overwrites it. Change the script in the repository instead.

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Left on plain HTTP so certbot can renew without a redirect dance.
    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type text/plain;
        try_files \$uri =404;
    }
EOF

  if [ "$HAS_CERT" = "1" ]; then
    cat >> "$out" <<EOF

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
  else
    cat >> "$out" <<EOF

    # No certificate yet: serve the channel over HTTP so the files can be
    # checked end to end before TLS is issued.
${manifest_location}

    location / {
        root ${WEBROOT};
        index index.html;
        try_files \$uri \$uri/ =404;
    }
}
EOF
  fi

  if [ "$HAS_CERT" = "1" ]; then
    cat >> "$out" <<EOF

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate     ${cert};
    ssl_certificate_key ${key};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    root ${WEBROOT};
    index index.html;

    access_log ${LOG_DIR}/${DOMAIN}-access.log;
    error_log  ${LOG_DIR}/${DOMAIN}-error.log;

${manifest_location}

    # Version-pinned artifacts never change, so they can be cached hard.
    location ^~ /release/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        types { application/x-xpinstall xpi; }
    }

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
  fi

  install -m 0644 "$out" "$conf"
  if [ "$HAS_CERT" = "1" ]; then
    log "vhost written to ${conf} (HTTPS enabled)"
  else
    log "vhost written to ${conf} (HTTP only — no certificate yet)"
  fi
}

write_vhost

# ------------------------------------------------------------------- 6. reload
log "testing nginx configuration"
"$NGINX_BIN" -t -c "$NGINX_CONF" -q || die "nginx configuration test failed; not reloading"

log "reloading nginx"
"$NGINX_BIN" -s reload -c "$NGINX_CONF"

# --------------------------------------------------------------------- 7. cert
if [ "$ISSUE_CERT" = "1" ] && [ "$HAS_CERT" = "0" ]; then
  command -v certbot >/dev/null 2>&1 || die "certbot is not installed"
  log "requesting a certificate for ${DOMAIN}"
  # Resolving ${DOMAIN} to this host is a prerequisite; HTTP-01 validation fails
  # otherwise and certbot will say so explicitly.
  certbot certonly --webroot -w "$ACME_WEBROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos --keep-until-expiring \
    ${EMAIL:+--email "$EMAIL"} \
    || die "certbot failed — check that ${DOMAIN} resolves to this server and port 80 is reachable"

  HAS_CERT=1
  write_vhost
  "$NGINX_BIN" -t -c "$NGINX_CONF" -q || die "nginx configuration test failed after issuing the certificate"
  "$NGINX_BIN" -s reload -c "$NGINX_CONF"
fi

# ------------------------------------------------------------------- 8. verify
SCHEME=http
PORT=80
if [ "$HAS_CERT" = "1" ]; then
  SCHEME=https
  PORT=443
fi

log "verifying over ${SCHEME} on loopback"
for path in /updates.json "/release/${ARTIFACT}-${VER}.xpi" /; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' -k --max-time 20 \
          --resolve "${DOMAIN}:${PORT}:127.0.0.1" \
          "${SCHEME}://${DOMAIN}${path}" 2>/dev/null || echo 000)"
  printf '    %-46s %s\n' "$path" "$code"
done

# Read the manifest back through nginx rather than off disk: that is what a
# client actually gets, so it also catches a vhost that resolves to the wrong
# root or a cache layer serving something stale.
SERVED_FILE="${TMP}/served-updates.json"
if curl -sS -k --max-time 20 --resolve "${DOMAIN}:${PORT}:127.0.0.1" \
     -o "$SERVED_FILE" "${SCHEME}://${DOMAIN}/updates.json"; then
  DEPLOYED_SUM="$(sha256sum "$WEBROOT/updates.json" | awk '{print $1}')"
  SERVED_SUM="$(sha256sum "$SERVED_FILE" | awk '{print $1}')"
  if [ "$DEPLOYED_SUM" != "$SERVED_SUM" ]; then
    die "the manifest served over ${SCHEME} is not the file that was deployed
       deployed: ${DEPLOYED_SUM}
       served  : ${SERVED_SUM}"
  fi
  log "served manifest is byte-identical to the deployed file"

  SERVED_VER="$(newest_version "$SERVED_FILE")"
  if [ "$SERVED_VER" = "$VER" ]; then
    log "served manifest publishes version ${VER}, as expected"
  else
    die "served manifest reports ${SERVED_VER}, expected ${VER}"
  fi
else
  warn "could not read the manifest back over loopback — check ${LOG_DIR}/${DOMAIN}-error.log"
fi

log "done"
cat <<EOF

  channel : ${SCHEME}://${DOMAIN}/updates.json
  xpi     : ${SCHEME}://${DOMAIN}/release/${ARTIFACT}-${VER}.xpi
  webroot : ${WEBROOT}

EOF

if [ "$HAS_CERT" = "0" ]; then
  warn "served over plain HTTP only. Add a DNS A record for ${DOMAIN} pointing at"
  warn "this host, then re-run with --issue-cert. Zotero accepts an HTTP link when"
  warn "update_hash is present, but HTTPS is what you actually want in production."
fi
