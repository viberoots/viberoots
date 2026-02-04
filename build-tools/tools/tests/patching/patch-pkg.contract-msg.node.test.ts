#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-pkg prints patch model one-liner for importer-local languages (node)", async () => {
  await runInTemp("patch-pkg-contract-msg-node", async (tmp, $) => {
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

    await $({ cwd: importer, env })`${cli} start node lodash --importer ${importer}`;
    const out = await $({
      cwd: importer,
      env,
      stdio: "pipe",
    })`${cli} apply node lodash --importer ${importer}`.nothrow();

    const all = String(out.stdout || "") + String(out.stderr || "");
    if (!all.includes("glue pipeline will run (graph, providers, auto_map)")) {
      console.error("expected standardized glue message missing");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }
  });
});
