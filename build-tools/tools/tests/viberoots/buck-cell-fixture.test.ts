#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";

async function writeFile(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
}

test("viberoots Buck fixture resolves split cells and canonical target labels", async () => {
  await runInScratchTemp("viberoots-buck-cell", async (tmp, $) => {
    await writeFile(path.join(tmp, ".buckroot"), ".\n");
    await writeFile(
      path.join(tmp, ".buckconfig"),
      `[buildfile]
name = TARGETS

[repositories]
root = .
viberoots = ./.viberoots/current
workspace_providers = ./.viberoots/workspace/providers

[cells]
root = .
viberoots = ./.viberoots/current
workspace_providers = ./.viberoots/workspace/providers
`,
    );
    await writeFile(
      path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl"),
      `MODULE_PROVIDERS = {}

def _provider_probe_impl(_ctx):
    return [DefaultInfo()]

provider_probe = rule(impl = _provider_probe_impl, attrs = {})
`,
    );
    await writeFile(
      path.join(tmp, ".viberoots/workspace/providers/.buckconfig"),
      "[buildfile]\nname = TARGETS\n",
    );
    await writeFile(
      path.join(tmp, ".viberoots/workspace/providers/TARGETS"),
      `load(":auto_map.bzl", "provider_probe")

provider_probe(name = "auto_map")
`,
    );
    await writeFile(
      path.join(tmp, ".viberoots/current/macros/defs.bzl"),
      `load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")

if type(MODULE_PROVIDERS) != type({}):
    fail("MODULE_PROVIDERS must be a dict")

SPLIT_CELL_PROBE = "ok"

def _viberoots_probe_impl(_ctx):
    return [DefaultInfo()]

viberoots_probe = rule(impl = _viberoots_probe_impl, attrs = {})
`,
    );
    await writeFile(
      path.join(tmp, ".viberoots/current/.buckconfig"),
      "[buildfile]\nname = TARGETS\n",
    );
    await writeFile(
      path.join(tmp, ".viberoots/current/macros/TARGETS"),
      `load(":defs.bzl", "viberoots_probe")

viberoots_probe(name = "defs_bzl")
`,
    );
    await writeFile(
      path.join(tmp, "TARGETS"),
      `load("@viberoots//macros:defs.bzl", "SPLIT_CELL_PROBE")

`,
    );

    const cells = await $({ cwd: tmp, stdio: "pipe" })`buck2 audit cell`;
    const cellOutput = String(cells.stdout || "");
    const realTmp = await fsp.realpath(tmp);
    assert.match(cellOutput, new RegExp(`viberoots: ${realTmp}/\\.viberoots/current`));
    assert.match(
      cellOutput,
      new RegExp(`workspace_providers: ${realTmp}/\\.viberoots/workspace/providers`),
    );

    await $({ cwd: tmp, stdio: "pipe" })`buck2 targets //...`;
    const viberootsTarget = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery viberoots//macros:defs_bzl`;
    const providersTarget = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery workspace_providers//:auto_map`;
    const labels = `${viberootsTarget.stdout || ""}\n${providersTarget.stdout || ""}`;
    assert.match(labels, /viberoots\/\/macros:defs_bzl/);
    assert.match(labels, /workspace_providers\/\/:auto_map/);
    assert.doesNotMatch(labels, /@(?:viberoots|workspace_providers)\/\//);
  });
});
