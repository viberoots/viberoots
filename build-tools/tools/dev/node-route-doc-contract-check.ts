#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { getFlagStr } from "../lib/cli";

type ContractDoc = {
  label: string;
  path: string;
  requiredFragments: string[];
};

function missingFragments(content: string, requiredFragments: string[]): string[] {
  return requiredFragments.filter((fragment) => !content.includes(fragment));
}

async function main() {
  const prPlanPath = getFlagStr("pr-plan", "docs/handbook/nix-gaps-prs.md");
  const inventoryPath = getFlagStr("nix-gaps", "docs/handbook/nix-gaps.md");
  const designPath = getFlagStr("build-system-design", "build-tools/docs/build-system-design.md");

  const docs: ContractDoc[] = [
    {
      label: "pr-plan",
      path: prPlanPath,
      requiredFragments: [
        "## PR-21: Close Node gen/lib/bin/stage/inline gaps and enforce route parity (superseded in part by PR-23)",
        "PR-21 is superseded by PR-23 for the `node_asset_stage` and `node_wasm_inline_module` route",
        "Final enforced route contract for those two macros is: `standalone nix-calling genrule route`.",
      ],
    },
    {
      label: "nix-gaps inventory",
      path: inventoryPath,
      requiredFragments: [
        "- `node_asset_stage` → Nix build (`standalone nix-calling genrule route`).",
        "- `node_wasm_inline_module` → Nix build (`standalone nix-calling genrule route`).",
        "| `node_asset_stage`",
        "| `node_wasm_inline_module`",
        "Uses standalone nix-calling genrule route with selected-build out-path capture and shared wiring.",
      ],
    },
    {
      label: "build-system design",
      path: designPath,
      requiredFragments: [
        "`node_asset_stage` and `node_wasm_inline_module` use standalone nix-calling genrule route in `build-tools/node/defs_stage.bzl`",
        "`nix_build_out_path_cmd`",
      ],
    },
  ];

  const failures: string[] = [];
  for (const doc of docs) {
    const content = await fs.readFile(doc.path, "utf8");
    const missing = missingFragments(content, doc.requiredFragments);
    if (missing.length === 0) continue;
    failures.push(`${doc.label} (${doc.path})`);
    for (const fragment of missing)
      failures.push(`- missing required contract fragment: ${fragment}`);
  }

  if (failures.length > 0) {
    console.error("Node route docs contract mismatch:");
    for (const line of failures) console.error(line);
    process.exit(1);
  }

  console.log("node-route-doc-contract-check: OK");
}

main().catch((error) => {
  console.error(String((error as any)?.stack || error));
  process.exit(1);
});
