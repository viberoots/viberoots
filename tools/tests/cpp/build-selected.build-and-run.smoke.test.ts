#!/usr/bin/env zx-wrapper
// tools/tests/cpp/build-selected.build-and-run.smoke.test.ts
// Minimal smoke test: use the helper to build and run the sample C++ app in apps/foo.

import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";
import { sanitizeAttrNameFromLabel } from "../../lib/labels";

async function main() {
  await runInTemp("build-selected-smoke", async (tmp, $) => {
    const repo = process.cwd();

    // Ensure required structure and copy only what's needed to avoid ENOSPC
    await fs.ensureDir(path.join(tmp, "tools", "dev"));
    await fs.ensureDir(path.join(tmp, "tools", "buck"));
    await fs.ensureDir(path.join(tmp, "third_party", "providers"));

    const pairs: Array<[string, string]> = [
      [path.join(repo, "flake.nix"), path.join(tmp, "flake.nix")],
      [path.join(repo, "tools", "nix"), path.join(tmp, "tools", "nix")],
      [path.join(repo, "toolchains"), path.join(tmp, "toolchains")],
      [
        path.join(repo, "tools", "dev", "build-selected.ts"),
        path.join(tmp, "tools", "dev", "build-selected.ts"),
      ],
      [
        path.join(repo, "tools", "buck", "export-graph.ts"),
        path.join(tmp, "tools", "buck", "export-graph.ts"),
      ],
      [path.join(repo, "third_party", "providers"), path.join(tmp, "third_party", "providers")],
    ];
    for (const [src, dst] of pairs) {
      if (await fs.pathExists(src)) {
        const s = await fs.stat(src);
        if (s.isDirectory()) {
          await fs.copy(src, dst);
        } else {
          await fs.ensureDir(path.dirname(dst));
          await fs.copy(src, dst);
        }
      }
    }

    // Ensure languages manifest enables C++ so export-graph includes cpp labels
    await fs.ensureDir(path.join(tmp, "tools", "nix"));
    await fs.writeFile(
      path.join(tmp, "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    // Create a minimal C++ app in the temp repo and its TARGETS
    const appDir = path.join(tmp, "apps", "demo");
    await fs.ensureDir(path.join(appDir, "src"));
    await fs.writeFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");
    // Provide cpp macro defs
    await fs.ensureDir(path.join(tmp, "cpp"));
    await fs.copy(path.join(repo, "cpp", "defs.bzl"), path.join(tmp, "cpp", "defs.bzl"));
    // Also copy cpp/private so defs.bzl loads resolve (planner_stub, nix_build, etc.)
    await fs.copy(path.join(repo, "cpp", "private"), path.join(tmp, "cpp", "private"));
    const targets = [
      'load("//cpp:defs.bzl", "nix_cpp_binary")',
      "",
      "nix_cpp_binary(",
      '    name = "demo",',
      '    srcs = ["src/main.cpp"],',
      '    labels = ["lang:cpp", "kind:bin"],',
      ")",
      "",
    ].join("\n");
    await fs.writeFile(path.join(appDir, "TARGETS"), targets, "utf8");

    // Ensure executable bit and run via zx-wrapper shebang
    await $({ cwd: tmp })`chmod +x tools/dev/build-selected.ts`;
    const label = "//apps/demo:demo";
    const cppTargetAttrSuffix = sanitizeAttrNameFromLabel(label);
    const env = {
      ...process.env,
      BUCK_TARGET: label,
      BUCK_TARGET_ATTR: cppTargetAttrSuffix,
      BUCK_TEST_SRC: tmp,
    } as any;
    const cmd = $({ cwd: tmp, env, reject: false, nothrow: true })`tools/dev/build-selected.ts`;
    const { stdout, stderr, exitCode } = await cmd;
    if (exitCode !== 0) {
      console.error("build-selected failed", stderr);
      process.exit(exitCode || 1);
    }
    const err = String(stderr || "");
    if (
      !new RegExp(
        `\\[build-selected\\] BUCK_TARGET=${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`,
      ).test(err)
    ) {
      console.error("missing BUCK_TARGET log in stderr", err);
      process.exit(2);
    }
    if (!/\[build-selected\] (exporting graph to|using existing graph:)/.test(err)) {
      console.error("missing graph export/usage log in stderr", err);
      process.exit(2);
    }
    if (
      !new RegExp(`\\[build-selected\\] cppTargetAttrSuffix=${cppTargetAttrSuffix}\\b`).test(err)
    ) {
      console.error("missing cppTargetAttrSuffix log in stderr", err);
      process.exit(2);
    }
    const outPath = String(stdout || "").trim();
    if (!outPath || !(await fs.pathExists(outPath))) {
      console.error("out path missing:", outPath);
      process.exit(2);
    }
    const binDir = path.join(outPath, "bin");
    const binEntries = (await fs.readdir(binDir).catch(() => [])) as string[];
    if (!binEntries.length) {
      console.error("no binaries found in", binDir);
      await $`ls -la ${outPath}`.nothrow();
      await $`ls -la ${binDir}`.nothrow();
      process.exit(2);
    }
    const bin = path.join(binDir, binEntries[0]);
    const run = await $({ reject: false, nothrow: true })`${bin}`;
    if (run.exitCode !== 0) {
      console.error("binary failed:", run.stderr);
      process.exit(run.exitCode || 1);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
