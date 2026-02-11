#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const scriptPath = "build-tools/tools/dev/nix-gaps-inventory-check.ts";
const exceptionsPath = "docs/handbook/nix-gaps-exceptions.json";

const starlarkApi = `# Starlark API reference

## Index

- \`//build-tools/go:defs.bzl\`
  - \`nix_go_library\`
  - \`nix_go_binary\`
- \`//build-tools/node:defs.bzl\`
  - \`nix_node_gen\`
  - \`nix_node_lib\`
  - \`node_webapp\`

## Go macros
`;

const nixGapsComplete = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Nix build (\`graph-generator-selected\`).
- \`nix_go_binary\` → Nix build (\`graph-generator-selected\`).

## Node macros

- \`nix_node_gen\` → Nix build (\`graph-generator-selected\`).
- \`nix_node_lib\` → Nix build (\`graph-generator-selected\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Nix build | migrated |
| \`nix_node_lib\` | artifact-producing | Nix build | migrated |
| \`node_webapp\` | orchestration wrapper | Nix build | wrapper |

## Exception policy (intentional non-build macros)

- \`cpp_sanitize_probe\` (test probe only, no production artifact contract).
`;

const nixGapsMissing = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).

## Node macros

- \`nix_node_gen\` → Buck build (\`genrule\`).
- \`nix_node_lib\` → Buck build (\`genrule\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Buck build | gap |
| \`nix_node_lib\` | artifact-producing | Buck build | gap |
| \`node_webapp\` | orchestration wrapper | Nix build | wrapper |

## Exception policy (intentional non-build macros)

- \`cpp_sanitize_probe\` (test probe only, no production artifact contract).
`;

const nixGapsMissingNodeClassification = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).
- \`nix_go_binary\` → Buck build (\`go_binary\`).

## Node macros

- \`nix_node_gen\` → Buck build (\`genrule\`).
- \`nix_node_lib\` → Buck build (\`genrule\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Buck build | gap |
| \`nix_node_lib\` | artifact-producing | Buck build | gap |

## Exception policy (intentional non-build macros)

- \`cpp_sanitize_probe\` (test probe only, no production artifact contract).
`;

const nixGapsMissingExceptionPolicy = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).
- \`nix_go_binary\` → Buck build (\`go_binary\`).

## Node macros

- \`nix_node_gen\` → Buck build (\`genrule\`).
- \`nix_node_lib\` → Buck build (\`genrule\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Buck build | gap |
| \`nix_node_lib\` | artifact-producing | Buck build | gap |
| \`node_webapp\` | orchestration wrapper | Nix build | wrapper |
`;

const exceptionsComplete = `{
  "exceptions": [
    {
      "macro": "cpp_sanitize_probe",
      "kind": "probe-only",
      "justification": "Test-only sanitizer probe with no production artifact contract."
    }
  ]
}
`;

const exceptionsMissingJustification = `{
  "exceptions": [
    {
      "macro": "cpp_sanitize_probe",
      "kind": "probe-only",
      "justification": ""
    }
  ]
}
`;

test("nix-gaps inventory check passes when inventory is complete", async () => {
  await runInTemp("nix-gaps-inventory-pass", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsComplete);
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsComplete);
    await $({
      cwd: tmp,
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`;
  });
});

test("nix-gaps inventory check fails when a macro is missing", async () => {
  await runInTemp("nix-gaps-inventory-fail", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsMissing);
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsComplete);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`.nothrow();

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /Missing macros in nix-gaps inventory/);
  });
});

test("nix-gaps inventory check fails when a Node macro is missing from classification table", async () => {
  await runInTemp("nix-gaps-node-classification-fail", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(
      path.join(tmp, "docs/handbook/nix-gaps.md"),
      nixGapsMissingNodeClassification,
    );
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsComplete);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`.nothrow();

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /Missing Node classification entries/);
  });
});

test("nix-gaps inventory check fails when exception policy section is missing", async () => {
  await runInTemp("nix-gaps-exception-policy-missing", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsMissingExceptionPolicy);
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsComplete);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`.nothrow();

    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /Missing section.*Exception policy/);
  });
});

test("nix-gaps inventory check fails when exception entry lacks justification", async () => {
  await runInTemp("nix-gaps-exception-justification-missing", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsComplete);
    await fs.outputFile(path.join(tmp, exceptionsPath), exceptionsMissingJustification);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath}`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /Malformed exception entries/);
  });
});
