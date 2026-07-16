#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-node start creates session and workspace (idempotent)", async () => {
  await runInTemp("patch-node-start", async (tmp, $) => {
    const importer = path.join(tmp, "apps", "example");
    await fs.mkdirp(importer);
    // minimal importer with lockfile and .npmrc patches-dir
    await fs.outputFile(
      path.join(importer, "pnpm-lock.yaml"),
      "importers:\n  apps/example: {}\n",
      "utf8",
    );
    await fs.outputFile(path.join(importer, ".npmrc"), "patches-dir=patches/node\n", "utf8");

    // Ensure CLI is executable
    const cli = path.join(tmp, "viberoots", "build-tools", "tools", "bin", "patch-pkg");
    await $`chmod +x ${cli}`;

    // Mock pnpm patch to print a temp dir path
    const fakeWs = path.join(tmp, "_pnpm_patch_ws");
    await fs.mkdirp(fakeWs);
    // Use a private, writable mock bin to avoid permission issues
    const mockBin = path.join(tmp, "_mockbin");
    await fs.mkdirp(mockBin);
    const mockPnpm = path.join(mockBin, "pnpm");
    const capturedNodeOptions = path.join(tmp, "pnpm-node-options.txt");
    await fs.outputFile(
      mockPnpm,
      `#!/usr/bin/env bash\nprintf '%s' "${"$"}{NODE_OPTIONS-}" > "${capturedNodeOptions}"\nif [ "$1" = "patch" ]; then echo "${fakeWs}"; else echo "ok"; fi\n`,
      { encoding: "utf8" },
    );
    await $`chmod +x ${mockPnpm}`;

    const env = {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH || ""}`,
      PNPM_BIN: mockPnpm,
      NODE_OPTIONS: `--trace-warnings --import ${path.join(
        tmp,
        "viberoots",
        "build-tools",
        "tools",
        "dev",
        "zx-init.mjs",
      )} --max-old-space-size=256`,
    } as any;

    const r1 = await $({ cwd: importer, env })`${cli} start node lodash --importer ${importer}`;
    const ws1 = String(r1.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (ws1 !== fakeWs) {
      console.error("unexpected workspace path", ws1);
      process.exit(2);
    }
    const childNodeOptions = await fs.readFile(capturedNodeOptions, "utf8");
    if (childNodeOptions !== "--trace-warnings --max-old-space-size=256") {
      console.error("pnpm inherited orchestration NODE_OPTIONS", childNodeOptions);
      process.exit(2);
    }

    // Second start should be idempotent (reprints the same directory from pnpm mock)
    const r2 = await $({ cwd: importer, env })`${cli} start node lodash --importer ${importer}`;
    const ws2 = String(r2.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (ws2 !== fakeWs) {
      console.error("idempotent start returned different workspace path");
      process.exit(2);
    }
  });
});
