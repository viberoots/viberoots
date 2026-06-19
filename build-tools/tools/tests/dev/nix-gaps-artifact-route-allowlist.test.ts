#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const scriptPath = "viberoots/build-tools/tools/dev/nix-gaps-inventory-check.ts";
const exceptionsPath = "docs/handbook/nix-gaps-exceptions.json";

const starlarkApi = `# Starlark API reference

## Index

- \`@viberoots//build-tools/node:defs.bzl\`
  - \`nix_node_cli_bin\`

## Node macros
`;

const nixGapsMixedRoute = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Node macros

- \`nix_node_cli_bin\` → Mixed:
  - \`bundle = False\` → Buck build (copy via \`genrule\`).
  - \`bundle = True\` → Nix build (calls \`nix build\` in genrule).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_cli_bin\` | mixed wrapper/artifact-producing | Mixed | \`bundle=True\` is Nix; \`bundle=False\` is Buck copy path. |

## Exception policy (intentional non-build macros)

No probe-only public macros in this fixture.
`;

const nixGapsNoRouteGap = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Node macros

- \`nix_node_cli_bin\` → Nix build (\`graph-generator-selected\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_cli_bin\` | artifact-producing | Nix build | migrated |

## Exception policy (intentional non-build macros)

No probe-only public macros in this fixture.
`;

const exceptionsWithMixedAllowlist = `{
  "exceptions": [],
  "artifactRouteAllowlist": [
    {
      "macro": "nix_node_cli_bin",
      "kind": "mixed",
      "justification": "Temporary migration gap for bundle=False."
    }
  ]
}
`;

const exceptionsWithoutAllowlist = `{
  "exceptions": [],
  "artifactRouteAllowlist": []
}
`;

test("nix-gaps inventory check passes when mixed route is explicitly allowlisted", async () => {
  await runInTemp("nix-gaps-artifact-route-allowlist-pass", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsMixedRoute);
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsWithMixedAllowlist);
    await $({
      cwd: tmp,
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`;
  });
});

test("nix-gaps inventory check fails when mixed route is not allowlisted", async () => {
  await runInTemp("nix-gaps-artifact-route-allowlist-missing", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsMixedRoute);
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsWithoutAllowlist);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /Missing artifact route allowlist entries/);
  });
});

test("nix-gaps inventory check fails on stale artifact allowlist entries", async () => {
  await runInTemp("nix-gaps-artifact-route-allowlist-stale", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsNoRouteGap);
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsWithMixedAllowlist);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /Stale artifactRouteAllowlist entries/);
  });
});
