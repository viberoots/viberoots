#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const scriptPath = "viberoots/build-tools/tools/dev/node-route-doc-contract-check.ts";

const prPlanDoc = `## Close Node gen/lib/bin/stage/inline gaps and enforce route parity (superseded in part by another plan update)

Supersession note:

- This work is superseded for the \`node_asset_stage\` and \`node_wasm_inline_module\` route
  contract.
- Final enforced route contract for those two macros is: \`standalone nix-calling genrule route\`.
`;

const nixGapsDoc = `## Node macros

- \`node_asset_stage\` → Nix build (\`standalone nix-calling genrule route\`).
- \`node_wasm_inline_module\` → Nix build (\`standalone nix-calling genrule route\`).

| Macro                     | Outcome category   | Current route | Notes                                                            |
| ------------------------- | ------------------ | ------------- | ---------------------------------------------------------------- |
| \`node_asset_stage\`        | artifact-producing | Nix build     | Uses standalone nix-calling genrule route with selected-build out-path capture and shared wiring. |
| \`node_wasm_inline_module\` | artifact-producing | Nix build     | Uses standalone nix-calling genrule route with selected-build out-path capture and shared wiring. |
`;

const designDoc = `1. **Planner languages vs. macro-only languages:** \`node_asset_stage\` and \`node_wasm_inline_module\` use standalone nix-calling genrule route in \`build-tools/node/defs_stage.bzl\` and include selected-build out-path capture via \`nix_build_out_path_cmd\`.`;

test("node-route-doc-contract-check passes when docs contract is aligned", async () => {
  await runInTemp("node-route-doc-contract-check-pass", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps-prs.md"), prPlanDoc);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsDoc);
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/docs/build-system-design.md"),
      designDoc,
    );

    await $({
      cwd: tmp,
    })`node ${scriptPath} --pr-plan docs/handbook/nix-gaps-prs.md --nix-gaps docs/handbook/nix-gaps.md --build-system-design viberoots/build-tools/docs/build-system-design.md`;
  });
});

test("node-route-doc-contract-check fails when supersession marker drifts", async () => {
  await runInTemp("node-route-doc-contract-check-fail", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(
      path.join(tmp, "docs/handbook/nix-gaps-prs.md"),
      prPlanDoc.replace("(superseded in part by another plan update)", ""),
    );
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), nixGapsDoc);
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/docs/build-system-design.md"),
      designDoc,
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --pr-plan docs/handbook/nix-gaps-prs.md --nix-gaps docs/handbook/nix-gaps.md --build-system-design viberoots/build-tools/docs/build-system-design.md`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /missing required contract fragment/);
  });
});
