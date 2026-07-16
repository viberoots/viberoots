#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { buildSelectedOutPath, runInTemp } from "../lib/test-helpers";
import { writePackagingNativeFixture } from "./packaging-native-fixture";
import { writePackagingTsFixture } from "./packaging-ts-fixture";

test("ts package packaging with conditional exports and artifact staging", async () => {
  await runInTemp("packaging", async (tmp, $) => {
    const git = $({ cwd: tmp, stdio: "pipe" });

    await git`git init`;
    await git`git config user.email test@example.com`;
    await git`git config user.name test`;

    await writePackagingNativeFixture(tmp);
    const tsPkg = await writePackagingTsFixture(tmp);

    // Keep Nix flake source filtering in sync with generated fixture files.
    await git`git add -A`;
    await git`git commit -m scaffold-fixture`;

    // 6) Generate glue (graph + providers + auto_map) for the temp repo to satisfy planner macros
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`${process.execPath} viberoots/build-tools/tools/dev/install/deps-main.ts --glue-only`;

    // 7) Build artifacts via selected builders and stage to dist/ manually (equivalent to the genrule)
    // Build TinyGo wasm via build-selected (same path used for addon below).
    const outWasmPath = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/math-api:wasm",
    });
    const wasmSrc = path.join(outWasmPath, "lib", "top.wasm");

    // Build Node addon (selected)
    const outAddonPath = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/math-native:napi_addon",
    });
    // Probe addon .node path (lib/*.node)
    const addonLibDir = path.join(outAddonPath, "lib");
    const addonFiles = await fs.readdir(addonLibDir);
    const nodeName = addonFiles.find((f) => f.endsWith(".node")) || "";
    if (!nodeName) throw new Error("addon .node artifact not found under nix out/lib");
    const addonSrc = path.join(addonLibDir, nodeName);

    // Stage dist files under projects/libs/math-ts/dist
    const distPath = path.join(tsPkg, "dist");
    await fs.mkdirp(path.join(distPath, "browser"));
    await fs.mkdirp(path.join(distPath, "node"));
    await fs.mkdirp(path.join(distPath, "native"));
    await fs.mkdirp(path.join(distPath, "types"));
    await fs.copyFile(
      path.join(tsPkg, "src", "browser", "index.js"),
      path.join(distPath, "browser", "index.js"),
    );
    await fs.copyFile(
      path.join(tsPkg, "src", "node", "index.cjs"),
      path.join(distPath, "node", "index.cjs"),
    );
    await fs.copyFile(
      path.join(tsPkg, "src", "types", "index.d.ts"),
      path.join(distPath, "types", "index.d.ts"),
    );
    await fs.copyFile(wasmSrc, path.join(distPath, "browser", "top.wasm"));
    await fs.copyFile(addonSrc, path.join(distPath, "native", "math_native.node"));

    // 8) Validate staged artifacts exist
    const expectFiles = [
      path.join(distPath, "browser", "index.js"),
      path.join(distPath, "browser", "top.wasm"),
      path.join(distPath, "node", "index.cjs"),
      path.join(distPath, "native", "math_native.node"),
      path.join(distPath, "types", "index.d.ts"),
    ];
    for (const f of expectFiles) {
      const ok =
        await $`bash --noprofile --norc -c ${`test -f "${f}" && echo ok || true`}`.nothrow();
      if (
        !String(ok.stdout || "")
          .trim()
          .includes("ok")
      ) {
        throw new Error("expected staged file missing: " + f);
      }
    }

    // 9) Simulate `import "@org/math"` via node_modules symlink and verify Node entry
    const nmScope = path.join(tmp, "node_modules", "@org");
    await fs.mkdirp(nmScope);
    const linkTarget = path.relative(
      path.join(nmScope),
      path.join(tmp, "projects", "libs", "math-ts"),
    );
    // Link node_modules/@org/math -> projects/libs/math-ts
    try {
      await fs.symlink(linkTarget, path.join(nmScope, "math"), "dir");
    } catch {
      // best-effort; may already exist
    }
    // Runner for Node path
    await fs.writeFile(
      path.join(tmp, "runner_node.cjs"),
      `
const m = require('@org/math');
const got = m.add(2, 3);
if (got !== 5) {
  console.error('expected 5, got', got);
  process.exit(2);
}
console.log('OK node', got);
`,
      "utf8",
    );
    await $({ cwd: tmp, stdio: "inherit" })`${process.execPath} runner_node.cjs`;

    // 10) Import the browser ESM entry directly and verify
    const browserUrl = "file://" + path.join(distPath, "browser", "index.js");
    const mod = await import(browserUrl);
    const got = typeof mod.add === "function" ? mod.add(2, 3) : 0;
    if (got !== 5) {
      throw new Error(`browser entry expected 5, got ${got}`);
    }
  });
});
