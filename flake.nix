# flake.nix — devshell and zx-wrapper
{
  description = "bucknix-fresh devshell and scaffolding";

  nixConfig = {
    allowed-impure-env-vars = [
      "BUCK_GRAPH_JSON"
      "ROOT_GOMOD2NIX_TOML"
      "BUCK_TEST_SRC"
      "BUCK_TARGET"
      "NIX_GO_DEV_OVERRIDE_JSON"
      "NIX_CPP_DEV_OVERRIDE_JSON"
      "NIX_PY_DEV_OVERRIDE_JSON"
      "NIX_PY_TEST_RESOLVE_JSON"
      "PLANNER_NO_DEV_OVERRIDE_LOG"
      "PLANNER_TRACE"
      "NIX_PNPM_ALLOW_GENERATE"
      "NIX_PNPM_FETCH_TIMEOUT"
      "NIX_NODE_TEST_PATTERNS"
      "COVERAGE"
      "WORKSPACE_ROOT"
      "TEST_RSYNC_ROOTS"
      "TEST_PARTIAL_CLONE_GO_ONLY"
      "TEST_EXCLUDE_CPP_REQS"
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    buck2.url = "github:facebook/buck2/201beb86106fecdc84e30260b0f1abb5bf576988";
    gomod2nix.url = "github:nix-community/gomod2nix";
    gomod2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, buck2, gomod2nix }:
    import ./build-tools/tools/nix/flake/outputs.nix { inherit self nixpkgs buck2 gomod2nix; };
}


