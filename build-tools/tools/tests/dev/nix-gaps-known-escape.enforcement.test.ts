#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import {
  enforceProductionCommandSiteInventory,
  inspectProductionCommandSites,
} from "../../dev/nix-gaps-command-sites";
import { runInTemp } from "../lib/test-helpers";

const policy = {
  schemaVersion: 1 as const,
  expectedCount: 0,
  expectedDigest: "",
  classificationRules: [
    {
      pathPattern: "^build-tools/node/",
      role: "canonical-artifact" as const,
      justification: "Fixture Node route constructs artifacts.",
    },
    {
      pathPattern: "^build-tools/tools/dev/update/",
      role: "update-install" as const,
      justification: "Fixture update route owns explicit reconciliation.",
    },
    {
      pathPattern: "^build-tools/tools/dev/dev-build/(?:args|materialize-impure)\\.ts$",
      role: "canonical-artifact" as const,
      justification: "Fixture exact diagnostic boundary.",
      allowedEscapes: ["diagnostic-impure" as const],
    },
    {
      pathPattern: "^build-tools/tools/dev/dev-build/",
      role: "canonical-artifact" as const,
      justification: "Fixture development build route.",
    },
    {
      pathPattern: "^build-tools/lang/nix_shell\\.bzl$",
      role: "canonical-artifact" as const,
      justification: "Fixture explicit diagnostic route.",
      allowedEscapes: ["diagnostic-impure" as const],
    },
    {
      pathPattern: "^Jenkinsfile$",
      role: "canonical-artifact" as const,
      justification: "Fixture root CI route constructs and verifies artifacts.",
    },
    {
      pathPattern: "^third_party/uv2nix/flake\\.nix$",
      role: "canonical-artifact" as const,
      justification: "Fixture reviewed third-party Nix source constructs artifacts.",
    },
  ],
};

test("canonical artifact inventory rejects automatic pnpm lock generation", async () => {
  await runInTemp("nix-gaps-auto-lock-escape", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/node/defs.bzl"),
      'cmd = "export NIX_PNPM_ALLOW_GENERATE=1; nix build --no-link"\n',
    );
    await assert.rejects(
      inspectProductionCommandSites(root, policy),
      /canonical artifact route enables automatic pnpm lock generation/,
    );
  });
});

test("canonical artifact inventory rejects unapproved impure evaluation", async () => {
  await runInTemp("nix-gaps-impure-escape", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/node/defs.bzl"),
      'cmd = "nix build --no-link --impure"\n',
    );
    await assert.rejects(
      inspectProductionCommandSites(root, policy),
      /canonical artifact route contains unapproved --impure evaluation/,
    );
  });
});

test("reviewed diagnostic helper may retain its explicit impure switch", async () => {
  await runInTemp("nix-gaps-diagnostic-impure", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/lang/nix_shell.bzl"),
      'cmd = "nix build --no-link --impure"\n',
    );
    const result = await inspectProductionCommandSites(root, policy);
    assert.equal(result.count, 1);
  });
});

test("explicit update inventory may own pnpm lock generation", async () => {
  await runInTemp("nix-gaps-update-lock-generation", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/tools/dev/update/pnpm.ts"),
      'const env = { NIX_PNPM_ALLOW_GENERATE: "1" };\n',
    );
    const result = await inspectProductionCommandSites(root, policy);
    assert.equal(result.count, 0);
  });
});

test("diagnostic impure permission does not extend to neighboring dev-build files", async () => {
  await runInTemp("nix-gaps-exact-impure", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/tools/dev/dev-build/runner.ts"),
      "await $`nix build --no-link --impure`\n",
    );
    await assert.rejects(
      inspectProductionCommandSites(root, policy),
      /canonical artifact route contains unapproved --impure evaluation/,
    );
  });
});

test("inventory discovers multiline zx commands", async () => {
  await runInTemp("nix-gaps-multiline-zx", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/tools/dev/update/runner.ts"),
      "await $(\n  { cwd: root },\n)`nix build --no-link`\n",
    );
    const result = await inspectProductionCommandSites(root, policy);
    assert.equal(result.count, 1);
  });
});

test("scaffolding templates reject impure build instructions", async () => {
  await runInTemp("nix-gaps-template-impure", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "build-tools/tools/scaffolding/templates/toy/README.md.jinja"),
      "nix build --no-link --impure\n",
    );
    await assert.rejects(
      inspectProductionCommandSites(root, policy),
      /canonical artifact route contains unapproved --impure evaluation/,
    );
  });
});

test("inventory discovers reviewed root CI shell entrypoints", async () => {
  await runInTemp("nix-gaps-root-ci", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "Jenkinsfile"),
      "pipeline { stages { stage('build') { steps { sh 'nix build --no-link' } } } }\n",
    );
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    const result = await inspectProductionCommandSites(root, policy);
    assert.equal(result.count, 1);
    assert.equal(result.roleCounts["canonical-artifact"], 1);
  });
});

test("inventory rejects an unclassified root CI command", async () => {
  await runInTemp("nix-gaps-root-ci-unclassified", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(
      path.join(root, "Jenkinsfile"),
      "pipeline { stages { stage('build') { steps { sh 'nix build --no-link' } } } }\n",
    );
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    const unclassifiedPolicy = {
      ...policy,
      classificationRules: policy.classificationRules.filter(
        (rule) => rule.pathPattern !== "^Jenkinsfile$",
      ),
    };
    await assert.rejects(
      inspectProductionCommandSites(root, unclassifiedPolicy),
      /unclassified production command source: Jenkinsfile/,
    );
  });
});

test("reviewed root CI command drift invalidates the inventory digest", async () => {
  await runInTemp("nix-gaps-root-ci-drift", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    const jenkinsfile = path.join(root, "Jenkinsfile");
    await fs.outputFile(
      jenkinsfile,
      "pipeline { stages { stage('build') { steps { sh 'nix build --no-link' } } } }\n",
    );
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    const baseline = await inspectProductionCommandSites(root, policy);
    const reviewedPolicy = {
      ...policy,
      expectedCount: baseline.count,
      expectedDigest: baseline.digest,
    };
    await fs.outputFile(
      jenkinsfile,
      "pipeline { stages { stage('build') { steps { sh 'nix build --no-link'; sh 'buck2 test //...' } } } }\n",
    );
    await assert.rejects(
      enforceProductionCommandSiteInventory(root, reviewedPolicy),
      /production command-site inventory changed/,
    );
  });
});

test("inventory discovers the reviewed uv2nix artifact constructor", async () => {
  await runInTemp("nix-gaps-uv2nix", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    await fs.outputFile(
      path.join(root, "third_party/uv2nix/flake.nix"),
      '{ pkgs }: pkgs.stdenvNoCC.mkDerivation { name = "fixture"; }\n',
    );
    const result = await inspectProductionCommandSites(root, policy);
    assert.equal(result.count, 1);
    assert.equal(result.roleCounts["canonical-artifact"], 1);
  });
});

test("reviewed uv2nix constructor drift invalidates the inventory digest", async () => {
  await runInTemp("nix-gaps-uv2nix-drift", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    const flake = path.join(root, "third_party/uv2nix/flake.nix");
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    await fs.outputFile(flake, '{ pkgs }: pkgs.stdenvNoCC.mkDerivation { name = "one"; }\n');
    const baseline = await inspectProductionCommandSites(root, policy);
    await fs.outputFile(flake, '{ pkgs }: pkgs.stdenvNoCC.mkDerivation { name = "two"; }\n');
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

test("inventory discovers injected Nix command sites", async () => {
  await runInTemp("nix-gaps-injected-nix", async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(path.join(root, "build-tools/node/x.ts"), "await runNix([]);\n");
    assert.equal((await inspectProductionCommandSites(root, policy)).count, 1);
  });
});
