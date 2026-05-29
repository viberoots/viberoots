#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 6 ]; then
  echo "expected source snapshot and evidence handles" >&2
  exit 64
fi

for path in "$@"; do
  test -e "$path"
done

printf 'remote-ready-runner: ok\n'
