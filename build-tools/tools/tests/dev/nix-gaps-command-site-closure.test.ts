#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import {
  enforceProductionCommandSiteInventory,
  inspectProductionCommandSites,
  type CommandSiteInventoryPolicy,
} from "../../dev/nix-gaps-command-sites";
import { runInTemp } from "../lib/test-helpers";

const emptyPolicy: CommandSiteInventoryPolicy = {
  schemaVersion: 1,
  expectedCount: 0,
  expectedDigest: "",
  classificationRules: [],
};

test("canonical PR5 executor APIs are inventory command sites", async () => {
  await runInTemp("nix-gaps-api-sites", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/tools/ci/api-sites.ts"),
      `declare function runArtifactNix(opts: unknown): Promise<void>;
import { runArtifactTool as executeArtifact } from "./artifact-command";
type EvidenceWriter = { copyToEvidenceStore(opts: unknown): Promise<void> };
function runArtifactTool(opts) {}
const declaration = { runArtifactNix() {}, copyToEvidenceStore: () => undefined };
await runArtifactNix({});
await runArtifactTool({});
await runDeclaredArtifactPublisher({});
await withActiveReviewedRemoteNix({}, action);
await copyArtifactPathsToEvidenceStore({});
await copyToEvidenceStore({});
await executor.runArtifactNix({});
await context.runNix([]);
await writer.copyToEvidenceStore({});
await executeArtifact({});
`,
    );
    const actual = await inspectProductionCommandSites(root, {
      ...emptyPolicy,
      classificationRules: [
        {
          pathPattern: "^build-tools/tools/ci/",
          role: "canonical-artifact",
          justification: "Fixture canonical PR5 executor APIs.",
        },
      ],
    });
    assert.equal(actual.count, 10);
    assert.equal(actual.roleCounts["canonical-artifact"], 10);
  });
});

test("root flake bytes are an explicit inventory fingerprint authority", async () => {
  await runInTemp("nix-gaps-root-flake", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    await fs.outputFile(
      path.join(root, "flake.nix"),
      '{\n  nixConfig.allowed-impure-env-vars = [\n    "NIX_PNPM_ALLOW_GENERATE"\n  ];\n  outputs = _: {};\n}\n',
    );
    const policy: CommandSiteInventoryPolicy = {
      ...emptyPolicy,
      classificationRules: [
        {
          pathPattern: "^flake\\.nix$",
          role: "canonical-artifact",
          justification: "Fixture root flake fingerprint authority.",
        },
      ],
    };
    const baseline = await inspectProductionCommandSites(root, policy);
    assert.equal(baseline.count, 0);
    await fs.appendFile(path.join(root, "flake.nix"), "# reviewed drift\n");
    await assert.rejects(
      enforceProductionCommandSiteInventory(root, {
        ...policy,
        expectedCount: baseline.count,
        expectedDigest: baseline.digest,
      }),
      /production command-site inventory changed/,
    );
    await fs.appendFile(
      path.join(root, "flake.nix"),
      'builtins.getEnv "NIX_PNPM_ALLOW_GENERATE"\n',
    );
    await assert.rejects(
      inspectProductionCommandSites(root, policy),
      /enables automatic pnpm lock generation/,
    );
  });
});

test("new executable root, hook, and shim surfaces fail closed and stay fingerprinted", async () => {
  await runInTemp("nix-gaps-executable-surfaces", async (tmp, $) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    await $({ cwd: root })`git init --quiet`;
    const surfaces = ["root-command", ".husky/new-hook", ".buck2_shim/bin/new-shim"];
    for (const rel of surfaces) {
      await fs.outputFile(path.join(root, rel), "#!/bin/sh\nexec nix build .#artifact\n", {
        mode: 0o755,
      });
    }
    await $({ cwd: root })`git add ${surfaces}`;
    await assert.rejects(
      inspectProductionCommandSites(root, emptyPolicy),
      /unclassified production command source/,
    );
    const policy: CommandSiteInventoryPolicy = {
      ...emptyPolicy,
      classificationRules: [
        {
          pathPattern: "^(?:root-command|\\.husky/new-hook|\\.buck2_shim/bin/new-shim)$",
          role: "canonical-artifact",
          justification: "Fixture dynamically discovered executable authorities.",
        },
      ],
    };
    const baseline = await inspectProductionCommandSites(root, policy);
    assert.equal(baseline.count, 3);
    await fs.appendFile(path.join(root, ".husky/new-hook"), "# reviewed change\n");
    await assert.rejects(
      enforceProductionCommandSiteInventory(root, {
        ...policy,
        expectedCount: baseline.count,
        expectedDigest: baseline.digest,
      }),
      /production command-site inventory changed/,
    );
  });
});
