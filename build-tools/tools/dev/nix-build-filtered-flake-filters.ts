import { DEFAULT_FILTERED_FLAKE_CONFIG_PATHS } from "./filtered-flake-config-paths";

export { DEFAULT_FILTERED_FLAKE_CONFIG_PATHS } from "./filtered-flake-config-paths";

// prettier-ignore
export const DEFAULT_FILTERED_FLAKE_ROOT_FILES = [".buckconfig", ".buckroot", ".npmrc", "TARGETS", "eslint.config.js", "flake.lock", "flake.nix", "gomod2nix.toml", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json"];

// prettier-ignore
export const DEFAULT_FILTERED_FLAKE_ROOTS = ["build-tools", "cpp", "go", "lang", "node", "patches", "python", "tools", "third_party", "toolchains", "types", "viberoots"];

export const DEFAULT_FILTERED_FLAKE_WORKSPACE_PATHS = [
  ".viberoots/workspace/flake.nix",
  ".viberoots/workspace/flake.lock",
  ".viberoots/workspace/nixpkgs-source-registry-extension.nix",
  ".viberoots/workspace/providers",
];

export const FILTERED_FLAKE_RSYNC_EXCLUDES = [
  ".git",
  ".metadata_never_index",
  ".env",
  ".env.*",
  ".aws",
  ".ssh",
  ".netrc",
  ".pypirc",
  ".git-credentials",
  "node_modules",
  "buck-out",
  ".codex-logs",
  ".codex-*.log",
  ".full-test-output.log",
  ".patch-sessions.json",
  "test-logs",
  "/backups",
  "/cache",
  "/codex-test-logs",
  "/install-cache",
  "/nix-xdg-cache",
  "/pr-logs",
  "/prelude",
  "/viberoots-flake-input",
  "/xdg-cache",
  ".viberoots/buck",
  ".viberoots/buck/tmp",
  ".viberoots/cache",
  ".viberoots/codex-logs",
  ".viberoots/codex-test-logs",
  ".viberoots/current",
  ".viberoots/workspace/.viberoots",
  ".viberoots/workspace/backups",
  ".viberoots/workspace/buck",
  ".viberoots/workspace/cache",
  ".viberoots/workspace/codex-test-logs",
  ".viberoots/workspace/exact-env-smoke.out",
  ".viberoots/workspace/host-path",
  ".viberoots/workspace/install-cache",
  ".viberoots/workspace/nix-xdg-cache",
  ".viberoots/workspace/node",
  ".viberoots/workspace/prelude",
  ".viberoots/workspace/pr-logs",
  ".viberoots/workspace/viberoots-flake-input",
  ".viberoots/workspace/xdg-cache",
  "viberoots/.viberoots",
  "viberoots/backups",
  "viberoots/cache",
  "viberoots/codex-test-logs",
  "viberoots/install-cache",
  "viberoots/nix-xdg-cache",
  "viberoots/pr-logs",
  "viberoots/xdg-cache",
  "viberoots/.cache",
  "viberoots/.clinic",
  "viberoots/.codex-logs",
  "viberoots/.codex-*.log",
  "viberoots/.direnv",
  "viberoots/.full-test-output.log",
  "viberoots/.nix-gcroots",
  "viberoots/.patch-sessions.json",
  "viberoots/.pnpm-store",
  "viberoots/buck-out",
  "viberoots/build-tools/tmp",
  "viberoots/coverage",
  "viberoots/node_modules",
  "viberoots/prelude",
  "viberoots/result",
  "viberoots/result-*",
  "viberoots/test-logs",
  ".direnv",
  ".pnpm-store",
  ".pnpm-home",
  "coverage",
  ".clinic",
  ".turbo",
  ".cache",
  "dist",
  "build",
  ".vite",
  ".next",
  ".wasm-producer",
  ".node_modules.lockfile-guard.*",
  ".*.tmp",
  ".*.ts.??????",
  ".*.tsx.??????",
  ".*.js.??????",
  ".*.mjs.??????",
  "result",
  "result-*",
];

export function filteredFlakeRsyncExcludeArgs(): string[] {
  return FILTERED_FLAKE_RSYNC_EXCLUDES.flatMap((entry) => ["--exclude", entry]);
}

export function defaultFilteredFlakeSnapshotRelPaths(): string[] {
  return [
    ...DEFAULT_FILTERED_FLAKE_ROOT_FILES,
    ...DEFAULT_FILTERED_FLAKE_CONFIG_PATHS,
    ...DEFAULT_FILTERED_FLAKE_WORKSPACE_PATHS,
    ...DEFAULT_FILTERED_FLAKE_ROOTS,
  ];
}

export function defaultFilteredFlakeSnapshotRsyncSources(relPaths: readonly string[]): string[] {
  return relPaths.map((relPath) => `./${relPath}`);
}
