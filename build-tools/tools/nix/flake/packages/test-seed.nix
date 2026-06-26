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

  # Root-level files and symlinks as a separate snapshot. Regular files and symlinks
  # are included; directories are excluded (filter returns false → builtins.path does
  # NOT recurse into them). Cost is proportional to the number of root entries, not the
  # full tree. Changes to subdirectories do not invalidate this store entry.
  #
  # Symlinks such as `prelude` (→ Nix store) are copied as symlinks here rather than
  # snapshotted via mkSubSnap below: builtins.path follows the top-level path symlink
  # when used as `path =`, so the filter's pStr check would compare the symlink path
  # against the resolved Nix-store paths, failing for all entries → empty snapshot.
  # Treating them as root-level symlinks avoids that problem entirely.
  rootFilesSnap = builtins.path {
    path = repoRoot;
    name = "seed-root-files";
    filter = fpath: type:
      let
        s = builtins.toString fpath;
        rootStr = builtins.toString repoRoot;
        rootWithSlash = rootStr + "/";
        rel = if lib.hasPrefix rootWithSlash s then lib.removePrefix rootWithSlash s else s;
      in
      rel == "" ||
      ((type == "regular" || type == "symlink") && !(lib.hasInfix "/" rel) && seedPred fpath type);
  };

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
  cp -a ${rootFilesSnap}/. "$out/"
  # cp -a preserves the Nix store directory's read-only mode on the destination;
  # restore write permission so subsequent mkdir calls into $out succeed.
  chmod u+w "$out"
  ${copySubDirScript}
  rm -rf \
    "$out/.viberoots/buck" \
    "$out/.viberoots/cache" \
    "$out/.viberoots/codex-logs" \
    "$out/.viberoots/workspace/.viberoots" \
    "$out/.viberoots/workspace/codex-test-logs" \
    "$out/build-tools/tmp" \
    "$out/viberoots/.viberoots"
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
