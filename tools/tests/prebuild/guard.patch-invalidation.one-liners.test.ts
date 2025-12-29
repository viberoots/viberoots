#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: prints patch invalidation one-liners with canonical vocabulary", async () => {
  await runInTemp("prebuild-patch-invalidation-one-liners", async (tmp, $) => {
    // Enable importer-scoped ecosystems
    await fsp.mkdir(path.join(tmp, "apps", "web"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "apps", "web", "pnpm-lock.yaml"),
      `lockfileVersion: "9.0"\nimporters:\n  apps/web:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await fsp.mkdir(path.join(tmp, "apps", "pytool"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "apps", "pytool", "uv.lock"), "", "utf8");

    // Enable package-local patching examples (Go + C++)
    await fsp.mkdir(path.join(tmp, "libs", "demo", "patches", "go"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "libs", "demo", "patches", "cpp"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "libs", "demo", "patches", "go", "example.com__x@1.0.0.patch"),
      "# fake\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "libs", "demo", "patches", "cpp", "pkgs__zlib@1.0.0.patch"),
      "# fake\n",
      "utf8",
    );

    // Ensure git is initialized so git ls-files finds our inputs
    await $({ cwd: tmp })`git init`;
    await $({
      cwd: tmp,
    })`git add apps/web/pnpm-lock.yaml apps/pytool/uv.lock libs/demo/patches/go/example.com__x@1.0.0.patch libs/demo/patches/cpp/pkgs__zlib@1.0.0.patch`;

    // Provide minimal outputs so the guard doesn't need to auto-fix to reach the notes.
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "tools", "buck", "graph.json"), "[]\n", "utf8");
    await fsp.writeFile(path.join(tmp, "tools", "buck", "node-lock-index.json"), "{}\n", "utf8");
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "nix_attr_map.bzl"),
      "# gen\nNIX_ATTR_MAP = {}\n",
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, PREBUILD_GUARD_NO_FIX: "1" },
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`.nothrow();

    const stderr = String((res as any).stderr || "");
    const expectLines = [
      "[prebuild] node patch_scope:importer-local — patch invalidation is driven by macro action inputs under <importer>/patches/node",
      "[prebuild] python patch_scope:importer-local — patch invalidation is driven by macro action inputs under <importer>/patches/python",
      "[prebuild] go patch_scope:package-local — patch invalidation is driven by <pkg>/patches/go included as action inputs",
      "[prebuild] cpp patch_scope:package-local — patch invalidation is driven by <pkg>/patches/cpp included as action inputs",
    ];
    for (const line of expectLines) {
      if (!stderr.includes(line)) {
        throw new Error(
          `expected prebuild-guard output to include:\n${line}\n\nGot stderr:\n${stderr}`,
        );
      }
    }
  });
});
