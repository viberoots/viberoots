import "./worker-init";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { timeAsync } from "./timing";

export async function rsyncRepoTo(tmp: string) {
  await timeAsync(`rsyncRepoTo(${path.basename(tmp)})`, async () => {
    const rootsEnv: string = (process.env.TEST_RSYNC_ROOTS || "").trim();
    if (rootsEnv) {
      const roots = rootsEnv
        .split(/[\,\s]+/)
        .map((r) => r.trim().replace(/^\/+/, ""))
        .filter(Boolean);
      try {
        await $`bash --noprofile --norc -c ${`set -euo pipefail
          if [ -f flake.nix ]; then mkdir -p "${tmp}"; cp -f flake.nix "${tmp}/flake.nix"; fi
          if [ -f flake.lock ]; then mkdir -p "${tmp}"; cp -f flake.lock "${tmp}/flake.lock"; fi
          if [ -f .viberoots/workspace/flake.nix ]; then mkdir -p "${tmp}/.viberoots/workspace"; cp -f .viberoots/workspace/flake.nix "${tmp}/.viberoots/workspace/flake.nix"; fi
          if [ -f .viberoots/workspace/flake.lock ]; then mkdir -p "${tmp}/.viberoots/workspace"; cp -f .viberoots/workspace/flake.lock "${tmp}/.viberoots/workspace/flake.lock"; fi
        `}`;
      } catch {}
      const rootsToCopy = new Set<string>(roots);
      const hasNestedViberoots = await fsp
        .access("viberoots/flake.nix")
        .then(() => true)
        .catch(() => false);
      if (hasNestedViberoots) {
        rootsToCopy.add("viberoots");
      }
      const extractedToolRoots = new Set([
        "build-tools",
        "patches",
        "prelude",
        "third_party/providers",
        "toolchains",
      ]);
      for (const r of rootsToCopy) {
        const exists = await fsp
          .lstat(r)
          .then(() => true)
          .catch(() => false);
        if (!exists && hasNestedViberoots && extractedToolRoots.has(r)) continue;
        try {
          await $`rsync -a --relative ${r} ${tmp}/`;
        } catch {}
      }
      return;
    }
    const goOnly = process.env.TEST_PARTIAL_CLONE_GO_ONLY === "1";
    const excludes = [
      "/buck-out",
      "buck-out",
      "/.viberoots/buck",
      "/.viberoots/cache",
      "/.viberoots/workspace/.viberoots",
      "/viberoots/.viberoots",
      "/.git",
      "/.claude/worktrees",
      "/.codex/worktrees",
      "/.buck",
      "/.nix-gcroots",
      "/.cache",
      "/.envrc",
      "/.buck2_shim",
      "/test-logs",
      "test-logs",
      "/apps",
      "/libs",
      "/.pnpm-store",
      ".unified-pnpm-store",
      "/node_modules",
      "/coverage",
      "/.clinic",
      "/.direnv",
      "/result",
      "/viberoots/build-tools/tools/buck/.export-cache",
      "/viberoots/build-tools/tools/buck/invalidation-report.txt",
      "/viberoots/build-tools/tools/buck/node-lock-index.json",
      "/viberoots/build-tools/tools/dev/toolchain-paths.json",
      "/docs",
      "/lang-design-docs",
      "/quad-alignment-*.md",
      "/trio-alignment-*.md",
      "/collect-garbage-log.txt",
      "/devbuild.run.*.out",
      "/run.*.out",
      "/v.*.out",
    ];
    if (goOnly) {
      excludes.push(
        "/cpp",
        "/viberoots/build-tools/tools/nix/templates",
        "/viberoots/build-tools/tools/scaffolding/templates",
      );
    }
    if (process.env.TEST_EXCLUDE_CPP_REQS === "1") {
      excludes.push(
        "/viberoots/build-tools/cpp/defs.bzl",
        "/viberoots/build-tools/cpp/wasm_defs.bzl",
        "/viberoots/build-tools/tools/nix/templates/cpp.nix",
      );
    }
    excludes.push("/third_party/providers/TARGETS.auto", "/third_party/providers/TARGETS.*.auto");
    // Volatile patch-session temp files may appear/disappear during a test run.
    // These are not part of the repo and should not make temp-repo seeding flaky.
    excludes.push("/.patch-sessions.json.tmp");
    const args = excludes.map((e) => ["--exclude", e]).flat();
    await $`rsync -a ${args} ./ ${tmp}/`;
  });
}
