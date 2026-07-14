import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("fixed pnpm store accepts only structurally empty package maps", async () => {
  const store = await fsp.readFile(
    path.join(root, "build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );

  assert.match(store, /yq -e '\(\.packages \/\/ \{\}\) \| length == 0' pnpm-lock\.yaml/);
  assert.match(store, /lockfile has no external packages; empty fixed store is valid/);
  assert.match(
    store,
    /pnpm fetch produced no content-addressed files for a lockfile with external packages/,
  );
  assert.match(store, /nativeBuildInputs = \[[^\]]*pkgs\.yq-go[^\]]*\]/);
});
