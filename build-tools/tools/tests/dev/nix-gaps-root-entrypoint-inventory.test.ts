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

const rules: CommandSiteInventoryPolicy["classificationRules"] = [
  {
    pathPattern: "^(?:\\.buck2_env\\.sh|\\.buck2_shim/bin/buck2)$",
    role: "canonical-artifact",
    justification: "Fixture root Buck authorities.",
  },
  {
    pathPattern: "^\\.envrc$",
    role: "non-artifact-orchestration",
    justification: "Fixture direnv shell entrypoint.",
  },
  {
    pathPattern: "^\\.husky/pre-commit$",
    role: "update-install",
    justification: "Fixture source-reconciling hook.",
  },
  {
    pathPattern: "^build-tools/tools/bin/(?:artifact-ingress-env\\.sh|build)$",
    role: "canonical-artifact",
    justification: "Fixture public artifact entrypoints.",
  },
  {
    pathPattern: "^build-tools/tools/bin/gomod2nix$",
    role: "update-install",
    justification: "Fixture dependency reconciliation entrypoint.",
  },
  {
    pathPattern: "^build-tools/tools/bin/[^./]+$",
    role: "non-artifact-orchestration",
    justification: "Fixture public orchestration entrypoints.",
  },
  {
    pathPattern: "^build-tools/node/",
    role: "canonical-artifact",
    justification: "Fixture canonical artifact route.",
  },
];

const policy: CommandSiteInventoryPolicy = {
  schemaVersion: 1,
  expectedCount: 0,
  expectedDigest: "",
  classificationRules: rules,
};

async function withRoot(name: string, run: (root: string) => Promise<void>): Promise<void> {
  await runInTemp(name, async (tmp) => {
    const root = path.join(tmp, "inventory-root");
    await fs.outputFile(path.join(root, "build-tools/placeholder.ts"), "export {};\n");
    await run(root);
  });
}

async function writeReviewedEntrypoints(root: string): Promise<void> {
  await fs.outputFile(path.join(root, ".buck2_env.sh"), 'buck2() { command buck2 "$@"; }\n');
  await fs.outputFile(
    path.join(root, ".buck2_shim/bin/buck2"),
    '#!/usr/bin/env bash\norig="/nix/store/fixture/bin/buck2"\nexec "$orig" "$@"\n',
  );
  await fs.outputFile(path.join(root, ".envrc"), "use flake\n");
  await fs.outputFile(
    path.join(root, ".husky/pre-commit"),
    "timeout 9m nix develop . -c lint-staged\n",
  );
}

test("inventory closes over reviewed root Buck, direnv, and hook entrypoints", async () => {
  await withRoot("nix-gaps-root-entrypoints", async (root) => {
    await writeReviewedEntrypoints(root);
    const actual = await inspectProductionCommandSites(root, policy);
    assert.equal(actual.count, 4);
    assert.deepEqual(actual.roleCounts, {
      "canonical-artifact": 2,
      "live-d": 0,
      "update-install": 1,
      "non-artifact-orchestration": 1,
    });
  });
});

test("shell inventory detects command and exec Nix or Buck entrypoints", async () => {
  await withRoot("nix-gaps-shell-exec", async (root) => {
    await fs.outputFile(
      path.join(root, "build-tools/node/entrypoints.sh"),
      "# command buck2 ignored\ncommand buck2 build //...\nexec nix build .#artifact\nexec buck2 test //...\n",
    );
    assert.equal((await inspectProductionCommandSites(root, policy)).count, 3);
  });
});

test("dynamic pinned Buck execution is recognized only in the reviewed shim", async () => {
  await withRoot("nix-gaps-pinned-buck", async (root) => {
    await fs.outputFile(
      path.join(root, "build-tools/node/unreviewed.sh"),
      'orig="/nix/store/fixture/bin/buck2"\nexec "$orig" "$@"\n',
    );
    assert.equal((await inspectProductionCommandSites(root, policy)).count, 0);
    await fs.outputFile(
      path.join(root, ".buck2_shim/bin/buck2"),
      'orig="/nix/store/fixture/bin/buck2"\n# exec "$orig" ignored\nexec "$orig" "$@"\n',
    );
    assert.equal((await inspectProductionCommandSites(root, policy)).count, 1);
  });
});

test("unclassified reviewed root entrypoints fail closed", async () => {
  await withRoot("nix-gaps-root-unclassified", async (root) => {
    await fs.outputFile(path.join(root, ".buck2_env.sh"), "command buck2 build //...\n");
    await assert.rejects(
      inspectProductionCommandSites(root, { ...policy, classificationRules: [] }),
      /unclassified production command source: \.buck2_env\.sh/,
    );
  });
});

test("reviewed root executable drift invalidates the inventory digest", async () => {
  await withRoot("nix-gaps-root-drift", async (root) => {
    await writeReviewedEntrypoints(root);
    const baseline = await inspectProductionCommandSites(root, policy);
    await fs.appendFile(path.join(root, ".buck2_shim/bin/buck2"), 'exec "$orig" status\n');
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

test("extensionless public CLIs are classified and fingerprinted without literal sites", async () => {
  await withRoot("nix-gaps-public-cli", async (root) => {
    const cli = path.join(root, "build-tools/tools/bin/build");
    await fs.outputFile(cli, '#!/usr/bin/env bash\nexec "$RUN_TS" build.ts\n');
    const baseline = await inspectProductionCommandSites(root, policy);
    assert.equal(baseline.count, 0);
    await fs.appendFile(cli, "# reviewed behavior changed\n");
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

test("artifact ingress environment bytes remain in the closed inventory", async () => {
  await withRoot("nix-gaps-artifact-ingress", async (root) => {
    const ingress = path.join(root, "build-tools/tools/bin/artifact-ingress-env.sh");
    await fs.outputFile(ingress, "artifact_ingress_clear_selectors() { :; }\n");
    const baseline = await inspectProductionCommandSites(root, policy);
    assert.equal(baseline.count, 0);
    await fs.appendFile(ingress, "  \n");
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

test("new extensionless public CLIs require an explicit reviewed role", async () => {
  await withRoot("nix-gaps-public-cli-unclassified", async (root) => {
    await fs.outputFile(path.join(root, "build-tools/tools/bin/new-command"), "exec tool\n");
    await assert.rejects(
      inspectProductionCommandSites(root, { ...policy, classificationRules: [] }),
      /unclassified production command source: build-tools\/tools\/bin\/new-command/,
    );
  });
});

test("exact quoted and indented extensionless Nix invocations are counted", async () => {
  await withRoot("nix-gaps-public-cli-nix", async (root) => {
    await fs.outputFile(
      path.join(root, "build-tools/tools/bin/gomod2nix"),
      'try_run "nix run .#gomod2nix"\ntry_run "nix run nixpkgs#gomod2nix"\ntry_run "nix shell nixpkgs#gomod2nix"\n',
    );
    await fs.outputFile(
      path.join(root, "build-tools/tools/bin/control-plane"),
      "if true; then\n  exec nix develop . -c control-plane\nfi\n",
    );
    await fs.outputFile(
      path.join(root, "build-tools/tools/bin/v"),
      "# timeout 10s buck2 ignored\nif true; then\n  timeout 10s buck2 kill\nfi\n",
    );
    const actual = await inspectProductionCommandSites(root, policy);
    assert.equal(actual.count, 5);
    assert.equal(actual.roleCounts["update-install"], 3);
    assert.equal(actual.roleCounts["non-artifact-orchestration"], 2);
  });
});
