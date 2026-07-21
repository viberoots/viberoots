#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { findRepoRoot } from "../../wasm/export-wasm-from-nix";
import { runInTemp } from "../lib/test-helpers";

test("export-wasm-from-nix resolves consumer root when launched under viberoots", async () => {
  await runInTemp("node-wasm-export-consumer-root", async (tmp) => {
    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(tmp, ".viberoots", "workspace", "flake.nix"), "{}\n");
    await fsp.mkdir(path.join(tmp, "viberoots"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "viberoots", "flake.nix"), "{}\n");

    assert.equal(await findRepoRoot(path.join(tmp, "viberoots")), path.resolve(tmp));
  });
});
