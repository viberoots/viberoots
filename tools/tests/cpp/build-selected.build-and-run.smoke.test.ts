#!/usr/bin/env zx-wrapper
// tools/tests/cpp/build-selected.build-and-run.smoke.test.ts
// Minimal smoke test: use the helper to build and run the sample C++ app in apps/foo.

import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

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
      [path.join(repo, "cpp"), path.join(tmp, "cpp")],
      [path.join(repo, "apps", "foo"), path.join(tmp, "apps", "foo")],
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

    // Ensure executable bit and run via zx-wrapper shebang
    await $({ cwd: tmp })`chmod +x tools/dev/build-selected.ts`;
    const env = { ...process.env, BUCK_TARGET: "//apps/foo:foo", BUCK_TEST_SRC: tmp } as any;
    const cmd = $({ cwd: tmp, env, reject: false, nothrow: true })`tools/dev/build-selected.ts`;
    const { stdout, stderr, exitCode } = await cmd;
    if (exitCode !== 0) {
      console.error("build-selected failed", stderr);
      process.exit(exitCode || 1);
    }
    const err = String(stderr || "");
    if (!/\[build-selected\] BUCK_TARGET=\/\/apps\/foo:foo/.test(err)) {
      console.error("missing BUCK_TARGET log in stderr", err);
      process.exit(2);
    }
    if (!/\[build-selected\] (exporting graph to|using existing graph:)/.test(err)) {
      console.error("missing graph export/usage log in stderr", err);
      process.exit(2);
    }
    const outPath = String(stdout || "").trim();
    if (!outPath || !(await fs.pathExists(outPath))) {
      console.error("out path missing:", outPath);
      process.exit(2);
    }
    const bin = path.join(outPath, "bin", "apps-foo-foo");
    if (!(await fs.pathExists(bin))) {
      console.error("expected binary not found:", bin);
      console.error("tree:");
      await $`ls -la ${outPath}`;
      await $`ls -la ${path.join(outPath, "bin")}`.nothrow();
      process.exit(2);
    }
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
