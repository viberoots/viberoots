#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("devshell exposes user-facing tools from Nix on PATH", async () => {
  const script = `
set -euo pipefail
for bin in nix buck2 node pnpm go python3 uv jq rsync copier yq gomod2nix viberoots zx-wrapper; do
  path="$(command -v "$bin")"
  case "$path" in
    /nix/store/*|"$PWD"/build-tools/tools/bin/*|"$PWD"/.direnv/bin/*|"$PWD"/node_modules/.bin/*) ;;
    *) echo "$bin resolved outside Nix/devshell paths: $path" >&2; exit 1 ;;
  esac
done
viberoots version --json >/dev/null
`;
  const result = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix develop --accept-flake-config .#default -c bash --noprofile --norc -c ${script}`;

  assert.equal(
    result.exitCode,
    0,
    `expected devshell tools on PATH\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
