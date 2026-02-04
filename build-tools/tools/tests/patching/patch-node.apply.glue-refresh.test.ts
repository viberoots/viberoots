#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-node apply runs glue and writes provider targets deterministically", async () => {
  await runInTemp("patch-node-apply", async (tmp, $) => {
    const importer = path.join(tmp, "apps", "example");
    await fs.mkdirp(importer);
    await fs.outputFile(
      path.join(importer, "pnpm-lock.yaml"),
      "importers:\n  apps/example:\n    dependencies:\n      lodash: 4.17.21\npackages:\n  /lodash/4.17.21: {}\n",
      "utf8",
    );
    await fs.outputFile(path.join(importer, ".npmrc"), "patches-dir=patches/node\n", "utf8");

    const cli = path.join(tmp, "build-tools", "tools", "bin", "patch-pkg");
    await $`chmod +x ${cli}`;

    const fakeWs = path.join(tmp, "_pnpm_patch_ws");
    await fs.mkdirp(fakeWs);
    const mockBin = path.join(tmp, "_mockbin");
    await fs.mkdirp(mockBin);
    const mockPnpm = path.join(mockBin, "pnpm");
    // Mock pnpm to echo workspace on patch and OK on patch-commit
    await fs.outputFile(
      mockPnpm,
      `#!/usr/bin/env bash\nif [ \"$1\" = \"patch\" ]; then echo \"${fakeWs}\"; elif [ \"$1\" = \"patch-commit\" ]; then echo ok; else echo ok; fi\n`,
      { encoding: "utf8" },
    );
    await $`chmod +x ${mockPnpm}`;

    const env = {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH || ""}`,
      PNPM_BIN: mockPnpm,
      ZX_INIT: path.join(tmp, "build-tools", "tools", "dev", "zx-init.mjs"),
      WORKSPACE_ROOT: tmp,
      NO_DEV_SHELL: "1",
    } as any;

    // Start → create session
    await $({ cwd: importer, env })`${cli} start node lodash --importer ${importer}`;

    // Verify session persisted under WORKSPACE_ROOT-relative key
    const storePath = path.join(tmp, ".patch-sessions.json");
    const store = JSON.parse(await fs.readFile(storePath, "utf8"));
    const key = "apps/example#lodash";
    if (!store?.sessions?.node?.[key]) {
      console.error("session record missing for node key", key);
      process.exit(2);
    }

    // Apply → write glue
    await $({ cwd: importer, env })`${cli} apply node lodash --importer ${importer}`;

    const autoTargets = path.join(tmp, "third_party", "providers", "TARGETS.node.auto");
    const autoMap = path.join(tmp, "third_party", "providers", "auto_map.bzl");
    if (!(await fs.pathExists(autoTargets)) || !(await fs.pathExists(autoMap))) {
      console.error("missing provider outputs; glue did not run");
      process.exit(2);
    }

    // Re-run apply (idempotent) and confirm files unchanged
    const beforeTargets = await fs.readFile(autoTargets, "utf8");
    const beforeMap = await fs.readFile(autoMap, "utf8");
    await $({ cwd: importer, env })`${cli} apply node lodash --importer ${importer}`;
    const afterTargets = await fs.readFile(autoTargets, "utf8");
    const afterMap = await fs.readFile(autoMap, "utf8");
    if (beforeTargets !== afterTargets || beforeMap !== afterMap) {
      console.error("provider outputs changed on idempotent re-apply");
      process.exit(2);
    }
  });
});
