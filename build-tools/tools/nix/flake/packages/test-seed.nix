{ pkgs, repoRoot }:
let
  lib = pkgs.lib;
  filterSeedRepo = import ./filter-seed-repo.nix { inherit lib; };
  seedSnapshot = builtins.path { path = filterSeedRepo repoRoot; name = "repo-seed"; };
in
pkgs.runCommand "test-seed" { nativeBuildInputs = [ pkgs.git ]; } ''
  set -euo pipefail
  mkdir -p "$out"
  cp -a ${seedSnapshot}/. "$out/"
  chmod -R u+w "$out"
  export GIT_AUTHOR_NAME=seed
  export GIT_AUTHOR_EMAIL=seed@example.com
  export GIT_COMMITTER_NAME=seed
  export GIT_COMMITTER_EMAIL=seed@example.com
  export GIT_AUTHOR_DATE=1970-01-01T00:00:00Z
  export GIT_COMMITTER_DATE=1970-01-01T00:00:00Z
  git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q "$out"
  git -C "$out" add -A
  git -C "$out" commit -q -m seed --allow-empty
''
