{ pkgs, repoRoot }:
let
  lib = pkgs.lib;
  # Read env-driven filter config here (the only impure site) rather than inside the
  # filter function, so filter-seed-repo.nix stays a pure function of its arguments.
  goOnly = builtins.getEnv "TEST_PARTIAL_CLONE_GO_ONLY" == "1";
  excludeCppReqs = builtins.getEnv "TEST_EXCLUDE_CPP_REQS" == "1";
  rootsEnv = lib.trim (builtins.getEnv "TEST_RSYNC_ROOTS");
  rootsRaw = if rootsEnv == "" then [] else builtins.split "[,[:space:]]+" rootsEnv;
  roots = lib.filter (r: r != "") (map (r: lib.removePrefix "/" r) rootsRaw);
  seedFilter = import ./filter-seed-repo.nix { inherit lib goOnly excludeCppReqs roots; };
  # The repo-root-relative predicate. Passed as the filter to every builtins.path call
  # below so that all exclusion logic (graph.json, nix_attr_map.bzl, etc.) is applied
  # consistently regardless of which subtree is being snapshotted.
  seedPred = seedFilter repoRoot;

  # Root-level files as individual snapshots. Avoid builtins.path over the whole repo
  # root here: local workspaces may contain root-level generated directories with
  # symlinks into /nix, and Nix can resolve those before the filter excludes them.
  rootFiles = [
    ".buckconfig"
    ".buckroot"
    ".editorconfig"
    ".gitattributes"
    ".gitignore"
    ".npmrc"
    ".prettierignore"
    ".prettierrc"
    "AGENTS.md"
    "Jenkinsfile"
    "LICENSE"
    "README.md"
    "TARGETS"
    "TESTING.md"
    "abstractions.md"
    "bootstrap"
    "eslint.config.js"
    "flake.lock"
    "flake.nix"
    "gomod2nix.toml"
    "init"
    "package.json"
    "pnpm-lock.yaml"
    "pnpm-workspace.yaml"
    "tsconfig.json"
  ];

  mkRootFileCopy = f:
    let
      p = repoRoot + "/${f}";
      snap =
        if builtins.pathExists p then
          builtins.path {
            path = p;
            name = "seed-root-${lib.replaceStrings ["."] [""] f}";
          }
        else null;
    in
    if snap != null then "cp -a ${snap} \"$out/${f}\"\n" else "";

  copyRootFileScript = lib.concatStrings (map mkRootFileCopy rootFiles);

  # Per-subdirectory snapshots. Each snapshot only walks its own subtree, so a
  # change to build-tools/ does not force go/ or cpp/ to be re-hashed, and vice versa.
  # seedPred uses repoRoot as its root context, so repo-root-relative exclusions
  # (e.g. .viberoots/workspace/buck/graph.json) apply correctly inside each subtree.
  # The subdirectory root entry is always included so builtins.path recurses into
  # the directory even when goOnly/excludeCppReqs would exclude all its contents
  # (which produces an empty snap — harmless when copied into the output tree).
  # Note: `prelude` is intentionally omitted — it is a symlink and is handled via
  # rootFilesSnap above (see comment there for why mkSubSnap cannot handle symlinks).
  subDirs = [".husky" ".viberoots" "build-tools" "cpp" "go" "lang" "node" "patches" "python" "tools" "third_party" "toolchains" "types" "viberoots"];

  mkSubSnap = d:
    let
      p = repoRoot + "/${d}";
      pStr = builtins.toString p;
    in
    if builtins.pathExists p then
      builtins.path {
        path = p;
        name = "seed-${lib.replaceStrings ["."] [""] d}";
        filter = fpath: type:
          if builtins.toString fpath == pStr then true
          else seedPred fpath type;
      }
    else null;

  # Shell fragment that copies each subtree into its correct destination path.
  # Store paths are interpolated at eval time so each is a separate derivation
  # input — Nix rebuilds test-seed only when at least one subtree hash changes,
  # and unchanged subtrees hit the store cache immediately without re-hashing.
  copySubDirScript = lib.concatStrings (map (d:
    let snap = mkSubSnap d; in
    if snap != null then
      "mkdir -p \"$out/${d}\"\ncp -a ${snap}/. \"$out/${d}/\"\n"
    else ""
  ) subDirs);
in
pkgs.runCommand "test-seed" { nativeBuildInputs = [ pkgs.git ]; } ''
	  set -euo pipefail
	  mkdir -p "$out"
	  ${copyRootFileScript}
	  ${copySubDirScript}
  rm -rf \
    "$out/.DS_Store" \
    "$out/.codex-logs" \
    "$out/.codex-"*.log \
    "$out/.full-test-output.log" \
    "$out/.patch-sessions.json" \
    "$out/viberoots-flake-input" \
    "$out/.viberoots/buck" \
    "$out/.viberoots/cache" \
    "$out/.viberoots/codex-logs" \
    "$out/.viberoots/workspace/.viberoots" \
    "$out/.viberoots/workspace/backups" \
    "$out/.viberoots/workspace/buck" \
    "$out/.viberoots/workspace/cache" \
    "$out/.viberoots/workspace/codex-test-logs" \
    "$out/.viberoots/workspace/install-cache" \
    "$out/.viberoots/workspace/nix-xdg-cache" \
    "$out/.viberoots/workspace/node" \
    "$out/.viberoots/workspace/pr-logs" \
    "$out/.viberoots/workspace/viberoots-flake-input" \
    "$out/.viberoots/workspace/xdg-cache" \
    "$out/build-tools/tmp" \
    "$out/viberoots/.cache" \
    "$out/viberoots/.clinic" \
    "$out/viberoots/.codex-logs" \
    "$out/viberoots/.codex-"*.log \
    "$out/viberoots/.DS_Store" \
    "$out/viberoots/.direnv" \
    "$out/viberoots/.full-test-output.log" \
    "$out/viberoots/.nix-gcroots" \
    "$out/viberoots/.patch-sessions.json" \
    "$out/viberoots/.pnpm-store" \
    "$out/viberoots/.viberoots" \
    "$out/viberoots/backups" \
    "$out/viberoots/buck-out" \
    "$out/viberoots/build-tools/tmp" \
    "$out/viberoots/cache" \
    "$out/viberoots/codex-test-logs" \
    "$out/viberoots/coverage" \
    "$out/viberoots/install-cache" \
    "$out/viberoots/nix-xdg-cache" \
    "$out/viberoots/node_modules" \
    "$out/viberoots/pr-logs" \
    "$out/viberoots/result" \
    "$out/viberoots/test-logs" \
    "$out/viberoots/xdg-cache"
  chmod -R u+w "$out"
  export GIT_AUTHOR_NAME=seed
  export GIT_AUTHOR_EMAIL=seed@example.com
  export GIT_COMMITTER_NAME=seed
  export GIT_COMMITTER_EMAIL=seed@example.com
  export GIT_AUTHOR_DATE=1970-01-01T00:00:00Z
  export GIT_COMMITTER_DATE=1970-01-01T00:00:00Z
  git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q "$out"
  # Nix evaluates local git flakes by accessing blob objects as direct loose-object
  # filesystem paths (.git/objects/XY/...). If git auto-gc runs and packs blobs, those
  # paths disappear and Nix evaluation fails. Keep gc.auto=0 so every blob in this seed
  # repo stays loose — tests that CoW-copy this seed and re-run git init get their own
  # fresh gc config, so this setting does not propagate beyond seed construction.
  git -C "$out" config gc.auto 0
  git -C "$out" add -A
  git -C "$out" commit -q -m seed --allow-empty
''
