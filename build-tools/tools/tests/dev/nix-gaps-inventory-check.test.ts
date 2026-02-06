#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const scriptPath = "build-tools/tools/dev/nix-gaps-inventory-check.ts";

const starlarkApi = `# Starlark API reference

## Index

- \`//build-tools/go:defs.bzl\`
  - \`nix_go_library\`
  - \`nix_go_binary\`
- \`//build-tools/node:defs.bzl\`
  - \`nix_node_lib\`

## Go macros
`;

const nixGapsComplete = `# Nix gaps (public macro inventory)

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).
- \`nix_go_binary\` → Buck build (\`go_binary\`).

## Node macros

- \`nix_node_lib\` → Buck build (\`genrule\`).
`;

const nixGapsMissing = `# Nix gaps (public macro inventory)

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).

## Node macros

- \`nix_node_lib\` → Buck build (\`genrule\`).
`;

test("nix-gaps inventory check passes when inventory is complete", async () => {
  await runInTemp("nix-gaps-inventory-pass", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsComplete);

    await $({
      cwd: tmp,
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md`;
  });
});

test("nix-gaps inventory check fails when a macro is missing", async () => {
  await runInTemp("nix-gaps-inventory-fail", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsMissing);

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md`.nothrow();

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /Missing macros in nix-gaps inventory/);
  });
});
