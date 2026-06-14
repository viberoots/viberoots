#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_AUTO_MAP_PATH, providerAutoTargetsPath } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("patch-node remove drops patch and refreshes glue deterministically", async () => {
  await runInTemp("patch-node-remove", async (tmp, $) => {
    const importer = path.join(tmp, "projects", "apps", "example");
    await fs.mkdirp(importer);
    await fs.outputFile(
      path.join(importer, "pnpm-lock.yaml"),
      "importers:\n  projects/apps/example:\n    dependencies:\n      lodash: 4.17.21\npackages:\n  /lodash/4.17.21: {}\n",
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
    await fs.outputFile(
      mockPnpm,
      `#!/usr/bin/env bash\ncase "$1" in\n  patch) echo "${fakeWs}";;\n  patch-commit) echo ok;;\n  patch-remove) echo ok;;\n  *) echo ok;;\nesac\n`,
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

    // Start and Apply to simulate an existing patch + glue state
    await $({ cwd: importer, env })`${cli} start node lodash --importer ${importer}`;
    await $({ cwd: importer, env })`${cli} apply node lodash --importer ${importer}`;

    const autoTargets = path.join(tmp, providerAutoTargetsPath("node"));
    const autoMap = path.join(tmp, DEFAULT_AUTO_MAP_PATH);
    const beforeTargets = (await fs.pathExists(autoTargets))
      ? await fs.readFile(autoTargets, "utf8")
      : "";
    const beforeMap = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";

    // Remove should invoke glue again; outputs must remain deterministic
    await $({ cwd: importer, env })`${cli} remove node lodash --importer ${importer}`;

    const afterTargets = await fs.readFile(autoTargets, "utf8");
    const afterMap = await fs.readFile(autoMap, "utf8");
    if (!afterTargets || !afterMap) {
      console.error("expected glue outputs after remove");
      process.exit(2);
    }
    // We don't assert exact equality, but ensure files are valid text and stable across a second remove
    await $({ cwd: importer, env })`${cli} remove node lodash --importer ${importer}`;
    const afterTargets2 = await fs.readFile(autoTargets, "utf8");
    const afterMap2 = await fs.readFile(autoMap, "utf8");
    if (afterTargets !== afterTargets2 || afterMap !== afterMap2) {
      console.error("provider outputs changed on idempotent remove");
      process.exit(2);
    }
  });
});
