#!/usr/bin/env zx-wrapper
// Asserts that with CI=true and NIX_CPP_DEV_OVERRIDE_JSON set, Nix eval fails.
async function main() {
  const env = {
    ...process.env,
    CI: "true",
    NIX_CPP_DEV_OVERRIDE_JSON: '{"pkgs.zlib":"/tmp/does-not-matter"}',
  };
  const expr = `
    let
      base = import <nixpkgs> {};
      pkgs = {
        lib = base.lib;
        llvmPackages = { clang = "/fake"; llvm = "/fake"; };
        nodejs = "/fake";
        nodejs_22 = "/fake";
      };
      C = import ./viberoots/build-tools/tools/nix/templates/cpp-common.nix { inherit pkgs; };
    in C._ci_guard
  `;
  const evalResult = await $({ env })`nix-instantiate --eval --strict -E ${expr}`.nothrow();
  const output = `${evalResult.stdout || ""}\n${evalResult.stderr || ""}`;
  if (evalResult.exitCode === 0) {
    console.error("expected CI guard to fail but it passed");
    process.exit(2);
  }
  if (!output.includes("Dev overrides are forbidden in CI")) {
    console.error(`expected CI guard failure, got:\n${output}`);
    process.exit(2);
  }
  console.log("OK: CI guard failed as expected");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
