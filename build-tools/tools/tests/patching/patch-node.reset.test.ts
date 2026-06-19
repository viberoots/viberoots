#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-node reset removes session and workspace", async () => {
  await runInTemp("patch-node-reset", async (tmp, $) => {
    const importer = path.join(tmp, "apps", "example");
    await fs.mkdirp(importer);
    await fs.outputFile(
      path.join(importer, "pnpm-lock.yaml"),
      "importers\n  apps/example: {}\n",
      "utf8",
    );
    await fs.outputFile(path.join(importer, ".npmrc"), "patches-dir=patches/node\n", "utf8");

    const cli = path.join(tmp, "viberoots", "build-tools", "tools", "bin", "patch-pkg");
    await $`chmod +x ${cli}`;

    const fakeWs = path.join(tmp, "_pnpm_patch_ws");
    await fs.mkdirp(fakeWs);
    const mockBin = path.join(tmp, "_mockbin");
    await fs.mkdirp(mockBin);
    const mockPnpm = path.join(mockBin, "pnpm");
    await fs.outputFile(
      mockPnpm,
      `#!/usr/bin/env bash\nif [ \"$1\" = \"patch\" ]; then echo \"${fakeWs}\"; else echo ok; fi\n`,
      { encoding: "utf8" },
    );
    await $`chmod +x ${mockPnpm}`;

    const env = {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH || ""}`,
      PNPM_BIN: mockPnpm,
      ZX_INIT: path.join(tmp, "viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
      WORKSPACE_ROOT: tmp,
      NO_DEV_SHELL: "1",
    } as any;

    // Start to create a session and workspace
    await $({ cwd: importer, env })`${cli} start node lodash --importer ${importer}`;
    const storePath = path.join(tmp, ".patch-sessions.json");
    const before = JSON.parse(await fs.readFile(storePath, "utf8"));
    if (!before?.sessions?.node?.["apps/example#lodash"]) {
      console.error("expected session to exist before reset");
      process.exit(2);
    }
    // Reset should remove session and delete workspace
    await $({ cwd: importer, env })`${cli} reset node lodash --importer ${importer}`;
    const after = JSON.parse(await fs.readFile(storePath, "utf8"));
    if (after?.sessions?.node?.["apps/example#lodash"]) {
      console.error("expected session to be removed after reset");
      process.exit(2);
    }
    if (await fs.pathExists(fakeWs)) {
      console.error("expected workspace directory to be deleted by reset");
      process.exit(2);
    }
  });
});
