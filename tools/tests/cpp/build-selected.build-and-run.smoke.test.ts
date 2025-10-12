#!/usr/bin/env zx-wrapper
// tools/tests/cpp/build-selected.build-and-run.smoke.test.ts
// Minimal smoke test: use the helper to build and run the sample C++ app in apps/foo.

import fs from "fs-extra";
import path from "node:path";

async function main() {
  // Prepare a temp workspace copy (rsync) like other tests do in this repo
  const repo = (await $`git rev-parse --show-toplevel`).stdout.trim();
  const tmp = (await $`mktemp -d ${path.join("/tmp", "bucknix-cpp-XXXXXX")}`).stdout.trim();

  // rsync a minimal subset is fine; reuse existing helper patterns
  await $`rsync -a --delete --exclude '.git' --exclude 'node_modules' --exclude 'coverage' --exclude '.clinic' ${repo}/ ${tmp}/`;

  // Ensure dir structure exists
  await fs.ensureDir(path.join(tmp, "tools", "buck"));

  // Export graph and build via helper
  const env = { ...process.env, BUCK_TARGET: "//apps/foo:foo", BUCK_TEST_SRC: tmp } as any;
  const cmd = $({
    cwd: tmp,
    env,
    reject: false,
    nothrow: true,
  })`nix run .#zx-wrapper -- tools/dev/build-selected.ts`;
  const { stdout, stderr, exitCode } = await cmd;
  if (exitCode !== 0) {
    console.error("build-selected failed", stderr);
    process.exit(exitCode || 1);
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
