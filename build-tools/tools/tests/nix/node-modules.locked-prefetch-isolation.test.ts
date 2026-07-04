#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("node-modules locked derivation ignores broken shared prefetched store inputs", async () => {
  await runInTemp("node-modules-locked-prefetch-isolation", async (tmp, _$) => {
    const importer = "projects/apps/demo-prefetch-safe";
    const attr = "projects-apps-demo-prefetch-safe";
    const importerAbs = path.join(tmp, "projects", "apps", "demo-prefetch-safe");
    await fsp.mkdir(importerAbs, { recursive: true });
    await fsp.writeFile(
      path.join(importerAbs, "package.json"),
      JSON.stringify(
        {
          name: "demo-prefetch-safe",
          private: true,
          version: "0.0.0",
          dependencies: { never: "1.1.0" },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerAbs, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "  .:",
        "    dependencies:",
        "      never:",
        "        specifier: 1.1.0",
        "        version: 1.1.0",
        "",
        "packages:",
        "  never@1.1.0:",
        "    resolution: {integrity: sha512-j8jTXd7vQ3M+iUu3/Jj3NKGLLeDzoTtSJMtfnQCA+4XIfTJ7AejvH4QtI5Q1lRv7+GEJQ2PlC0vDGVPYgGgTgQ==}",
        "",
      ].join("\n"),
      "utf8",
    );

    const brokenStore = path.join(tmp, "broken-prefetched-store");
    await fsp.mkdir(path.join(brokenStore, "v10", "files"), { recursive: true });
    await fsp.symlink(
      path.join(tmp, "missing-pnpm-blob"),
      path.join(brokenStore, "v10", "files", "dangling"),
    );

    const $ = _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        LOCAL_PNPM_STORE: brokenStore,
      },
    });

    const flakeRoot = await workspaceFlakeRef(tmp);
    const flakeRef = `path:${flakeRoot}`;
    const viberootsRoot =
      process.env.VIBEROOTS_SOURCE_ROOT ||
      process.env.VIBEROOTS_ROOT ||
      process.env.VIBEROOTS_FLAKE_INPUT_ROOT ||
      "";
    const override = viberootsRoot
      ? ` --override-input viberoots ${JSON.stringify(`path:${viberootsRoot}`)}`
      : "";
    const drvCmd = `nix eval --impure --raw "${flakeRef}#node-modules.${attr}.drvPath"${override} --accept-flake-config`;
    const out = await $`bash --noprofile --norc -c ${drvCmd}`;
    const drvPath = String(out.stdout || "").trim();
    assert.ok(drvPath.endsWith(".drv"), `expected drvPath, got: ${drvPath}`);

    for (const rel of [
      ".viberoots/workspace/cache/nix-tarballs/blob",
      ".viberoots/workspace/nix-xdg-cache/nix/tarball-cache-v2/pack",
      ".viberoots/workspace/xdg-cache/nix/tarball-cache-v2/pack",
    ]) {
      const abs = path.join(tmp, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, "cache churn\n", "utf8");
    }

    const afterCacheOut = await $`bash --noprofile --norc -c ${drvCmd}`;
    assert.equal(
      String(afterCacheOut.stdout || "").trim(),
      drvPath,
      "workspace cache roots must not perturb locked node_modules derivation identity",
    );
  });
});
