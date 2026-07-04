#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";

function consumerRoot(): string {
  const candidates = [
    process.env.WORKSPACE_ROOT || "",
    process.cwd(),
    path.dirname(process.cwd()),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (fs.existsSync(path.join(root, "viberoots", "flake.nix"))) return root;
  }
  return process.cwd();
}

test("devshell exposes user-facing tools from Nix on PATH", async (t) => {
  const root = consumerRoot();
  const direnvHome = await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-direnv-path-smoke-"));
  t.after(async () => {
    await fsp.rm(direnvHome, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    IN_NIX_SHELL: "",
    WORKSPACE_ROOT: root,
    VIBEROOTS_ROOT: "",
    VIBEROOTS_SOURCE_ROOT: "",
    _VIBEROOTS_DEVSHELL_ACTIVE: "",
    _VIBEROOTS_DEVSHELL_ROOT: "",
    XDG_CONFIG_HOME: path.join(direnvHome, "config"),
  };
  const currentTarget = await fsp.readlink(path.join(root, ".viberoots", "current"));
  assert.equal(currentTarget, "../viberoots");
  assert.equal(
    fs.existsSync(path.join(root, ".viberoots", "current", "prelude", "prelude.bzl")),
    true,
  );

  await $({
    cwd: root,
    env,
    stdio: "pipe",
  })`direnv allow .`;

  await $({
    cwd: root,
    env,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`direnv reload`;

  const result = await $({
    cwd: root,
    env,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`direnv exec . bash --noprofile --norc -c ${`
set -euo pipefail
ROOT="$PWD"
for bin in nix buck2 node pnpm go python3 uv jq rsync copier yq gomod2nix viberoots zx-wrapper s v i b; do
  path="$(command -v "$bin")"
  case "$path" in
    */buck-out/zx_shims/*/bin/buck2) if [ "$bin" = buck2 ]; then continue; fi ;;
    /nix/store/*|"$PWD"/.viberoots/current/build-tools/tools/bin/*|"$PWD"/.direnv/bin/*|"$PWD"/node_modules/.bin/*) ;;
    *) echo "$bin resolved outside Nix/devshell paths: $path" >&2; exit 1 ;;
  esac
done
cd projects
for bin in s v i b; do
  case "$(command -v "$bin")" in
    "$ROOT"/.viberoots/current/build-tools/tools/bin/"$bin"|"$ROOT"/.direnv/bin/"$bin"|/nix/store/*/bin/"$bin") ;;
    *) echo "$bin not available from projects via devshell path: $(command -v "$bin")" >&2; exit 1 ;;
  esac
done
viberoots version --json >/dev/null
`}`;

  assert.equal(
    result.exitCode,
    0,
    `expected devshell tools on PATH\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
