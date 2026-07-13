import "./worker-init";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { timeAsync } from "./timing";

function repoRsyncExcludeArgs(): string[] {
  const excludes = [
    "/buck-out",
    "buck-out",
    "/.viberoots/buck",
    "/.viberoots/cache",
    "/.viberoots/codex-logs",
    "/.viberoots/workspace/backups",
    "/.viberoots/workspace/buck",
    "/.viberoots/workspace/.viberoots",
    "/.viberoots/workspace/cache",
    "/.viberoots/workspace/codex-test-logs",
    "/.viberoots/workspace/install-cache",
    "/.viberoots/workspace/nix-xdg-cache",
    "/.viberoots/workspace/node",
    "/.viberoots/workspace/node-modules-hidden",
    "/.viberoots/workspace/pr-logs",
    "/.viberoots/workspace/viberoots-flake-input",
    "/.viberoots/workspace/xdg-cache",
    "/viberoots/.codex-logs",
    "/viberoots/.viberoots",
    "/build-tools/tmp",
    "/.git",
    "/.claude/worktrees",
    "/.codex/worktrees",
    "/.buck",
    "/.nix-gcroots",
    "/.cache",
    "/.codex-*.log",
    "/.full-test-output.log",
    "/.patch-sessions.json",
    "/.envrc",
    "/.buck2_shim",
    "/test-logs",
    "test-logs",
    "/apps",
    "/libs",
    "/.pnpm-store",
    ".unified-pnpm-store",
    "/backups",
    "/cache",
    "/codex-test-logs",
    "/install-cache",
    "/nix-xdg-cache",
    "/pr-logs",
    "/viberoots-flake-input",
    "/xdg-cache",
    "/node_modules",
    "/coverage",
    "/.clinic",
    "/.direnv",
    "/result",
    "/viberoots/build-tools/tools/buck/.export-cache",
    "/viberoots/build-tools/tools/buck/invalidation-report.txt",
    "/viberoots/build-tools/tools/buck/node-lock-index.json",
    "/viberoots/build-tools/tools/dev/toolchain-paths.json",
    "/viberoots/.codex-*.log",
    "/viberoots/.full-test-output.log",
    "/viberoots/.patch-sessions.json",
    "/viberoots/backups",
    "/viberoots/cache",
    "/viberoots/codex-test-logs",
    "/viberoots/install-cache",
    "/viberoots/node_modules",
    "/viberoots/nix-xdg-cache",
    "/viberoots/pr-logs",
    "/viberoots/test-logs",
    "/viberoots/xdg-cache",
    "/docs",
    "/lang-design-docs",
    "/quad-alignment-*.md",
    "/trio-alignment-*.md",
    "/collect-garbage-log.txt",
    "/devbuild.run.*.out",
    "/run.*.out",
    "/v.*.out",
  ];
  if (process.env.TEST_PARTIAL_CLONE_GO_ONLY === "1") {
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
  excludes.push("/.patch-sessions.json.tmp", ".live-edit-marker", ".source-fingerprint");
  return excludes.map((e) => ["--exclude", e]).flat();
}

const DEFAULT_RSYNC_ROOT_FILES = [
  ".buckconfig",
  ".buckroot",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  ".prettierrc",
  "AGENTS.md",
  "Jenkinsfile",
  "LICENSE",
  "README.md",
  "TARGETS",
  "TESTING.md",
  "abstractions.md",
  "bootstrap",
  "eslint.config.js",
  "flake.lock",
  "flake.nix",
  "gomod2nix.toml",
  "init",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
];

const DEFAULT_RSYNC_ROOTS = [
  ".husky",
  ".viberoots",
  "build-tools",
  "cpp",
  "go",
  "lang",
  "node",
  "patches",
  "prelude",
  "python",
  "tools",
  "third_party",
  "toolchains",
  "types",
  "viberoots",
];

async function pathExists(file: string): Promise<boolean> {
  return await fsp
    .lstat(file)
    .then(() => true)
    .catch(() => false);
}

export async function rsyncRepoTo(tmp: string) {
  await timeAsync(`rsyncRepoTo(${path.basename(tmp)})`, async () => {
    const sourceRoot = path.resolve(process.env.TEST_RSYNC_SOURCE_ROOT || process.cwd());
    const rootsEnv: string = (process.env.TEST_RSYNC_ROOTS || "").trim();
    const excludeArgs = repoRsyncExcludeArgs();
    if (rootsEnv) {
      const roots = rootsEnv
        .split(/[\,\s]+/)
        .map((r) => r.trim().replace(/^\/+/, ""))
        .filter(Boolean);
      try {
        await $`bash --noprofile --norc -c ${`set -euo pipefail
          cd "${sourceRoot}"
          if [ -f flake.nix ]; then mkdir -p "${tmp}"; cp -f flake.nix "${tmp}/flake.nix"; fi
          if [ -f flake.lock ]; then mkdir -p "${tmp}"; cp -f flake.lock "${tmp}/flake.lock"; fi
          if [ -f .viberoots/workspace/flake.nix ]; then mkdir -p "${tmp}/.viberoots/workspace"; cp -f .viberoots/workspace/flake.nix "${tmp}/.viberoots/workspace/flake.nix"; fi
          if [ -f .viberoots/workspace/flake.lock ]; then mkdir -p "${tmp}/.viberoots/workspace"; cp -f .viberoots/workspace/flake.lock "${tmp}/.viberoots/workspace/flake.lock"; fi
        `}`;
      } catch {}
      const rootsToCopy = new Set<string>(roots);
      const hasNestedViberoots = await fsp
        .access(path.join(sourceRoot, "viberoots", "flake.nix"))
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
        const sourcePath = path.join(sourceRoot, r);
        const exists = await fsp
          .lstat(sourcePath)
          .then(() => true)
          .catch(() => false);
        if (!exists && hasNestedViberoots && extractedToolRoots.has(r)) continue;
        try {
          await $({ cwd: sourceRoot })`rsync -a --relative ${excludeArgs} ${r} ${tmp}/`;
        } catch {}
      }
      return;
    }
    await fsp.mkdir(tmp, { recursive: true });
    for (const file of DEFAULT_RSYNC_ROOT_FILES) {
      if (await pathExists(path.join(sourceRoot, file))) {
        await $({ cwd: sourceRoot })`rsync -a --relative ${excludeArgs} ${file} ${tmp}/`;
      }
    }
    for (const root of DEFAULT_RSYNC_ROOTS) {
      if (await pathExists(path.join(sourceRoot, root))) {
        await $({ cwd: sourceRoot })`rsync -a --relative ${excludeArgs} ${root} ${tmp}/`;
      }
    }
    const overlayRoot = String(process.env.TEST_RSYNC_OVERLAY_ROOT || "").trim();
    if (overlayRoot) {
      await $`rsync -a ${excludeArgs} ${path.resolve(overlayRoot)}/ ${tmp}/`;
    }
  });
}
