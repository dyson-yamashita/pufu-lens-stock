#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

# APT checks the size of existing archives. Check their hashes against the
# refreshed package indexes before APT is allowed to reuse them.
for archive in "$1"/*.deb; do
  filename=${archive##*/}
  if [[ -f "$archive" && ! -L "$archive" &&
    "$filename" =~ ^([a-z0-9][a-z0-9+.-]*)_([a-zA-Z0-9.+~%-]+)_([a-z0-9-]+)\.deb$ ]]; then
    package=${BASH_REMATCH[1]}
    version=${BASH_REMATCH[2]//%3a/:}
    architecture=${BASH_REMATCH[3]}
    if [[ "$architecture" != all ]]; then
      package="$package:$architecture"
    fi

    checksum=$(sha256sum < "$archive")
    if apt-cache show -- "$package=$version" 2>/dev/null |
      grep -Fx "SHA256: ${checksum%% *}" >/dev/null; then
      continue
    fi
  fi
  rm -f -- "$archive"
done
