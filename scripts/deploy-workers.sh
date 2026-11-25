#!/usr/bin/env bash
set -eu
assets=$(mktemp -d "$PWD/dist/release-client.XXXXXXXX")
trap 'rm -rf -- "$assets"' EXIT
digest=$(node scripts/retain-assets.ts "$assets")
wrangler deploy --config dist/pufu_lens_pdf_parser/wrangler.json
wrangler deploy --config dist/pufu_lens_stock/wrangler.json --assets "$assets" --var "PUFU_ASSET_RELEASE_SHA256:$digest"
