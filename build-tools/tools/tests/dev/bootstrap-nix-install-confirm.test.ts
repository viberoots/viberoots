#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const bootstrap = viberootsSourcePath("viberoots/bootstrap");
const noNixPath = "/usr/bin:/bin:/usr/sbin:/sbin";

test("bootstrap refuses noninteractive Nix install without explicit allow", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-nix-confirm-"));
  const result = await $({
    env: { ...process.env, PATH: noNixPath },
  })`/bin/bash ${bootstrap} --workspace-root ${workspace} --no-run-install`.nothrow();
  assert.notEqual(result.exitCode, 0);
  assert.match(String(result.stderr), /refusing to install Nix without confirmation/);
  assert.match(String(result.stderr), /VBR_ALLOW_NIX_INSTALL=1/);
});

test("bootstrap dry-run distinguishes prompt from explicit Nix install consent", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-nix-dry-run-"));
  const prompt = await $({
    env: { ...process.env, PATH: noNixPath },
  })`/bin/bash ${bootstrap} --workspace-root ${workspace} --dry-run`.text();
  assert.match(prompt, /allow nix install prompt/);
  assert.match(prompt, /prompt before installing Nix with the Determinate Nix installer/);

  const allowed = await $({
    env: { ...process.env, PATH: noNixPath, VBR_ALLOW_NIX_INSTALL: "1" },
  })`/bin/bash ${bootstrap} --workspace-root ${workspace} --dry-run`.text();
  assert.match(allowed, /allow nix install yes/);
  assert.match(allowed, /install Nix with the Determinate Nix installer/);
  assert.doesNotMatch(allowed, /prompt before installing Nix/);
});
