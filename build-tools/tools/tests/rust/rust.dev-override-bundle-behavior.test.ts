#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
  validateArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { runInTemp } from "../lib/test-helpers";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const declaredArtifactToolsRoot = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "").trim();
const artifactToolsRoot = declaredArtifactToolsRoot
  ? validateArtifactToolsRoot(declaredArtifactToolsRoot, "declared Rust test artifact authority")
  : canonicalArtifactToolsRoot(sourceRoot);

test("local-development bundle applies the exact Rust override and reports its identity", async () => {
  await runInTemp("rust-dev-override-bundle", async (tmp, $) => {
    const stagedSource = path.join(tmp, "staged-source");
    const graphDir = path.join(stagedSource, ".viberoots/workspace/buck");
    const override = path.join(tmp, "override");
    const fixture = path.join(tmp, "fixture");
    const vendor = path.join(fixture, "vendor");
    const source = "registry+https://registry.example/private-index";
    const key = `dep@1.0.0#${source}`;
    await Promise.all(
      [graphDir, override, vendor].map((directory) => fsp.mkdir(directory, { recursive: true })),
    );
    await fsp.writeFile(path.join(stagedSource, "flake.nix"), "{ outputs = _: {}; }\n");
    await fsp.writeFile(path.join(stagedSource, "nonce.txt"), `${tmp}\n`);
    await fsp.writeFile(path.join(graphDir, "graph.json"), "[]\n");
    await fsp.writeFile(path.join(override, "lib.rs"), "pub fn value() -> u8 { 41 }\n");
    await fsp.writeFile(path.join(vendor, "lib.rs"), "pub fn value() -> u8 { 1 }\n");
    await fsp.writeFile(
      path.join(vendor, ".cargo-checksum.json"),
      JSON.stringify({ package: "fixture", files: {} }),
    );
    const lock = path.join(fixture, "Cargo.lock");
    await fsp.writeFile(
      lock,
      `version=3\n[[package]]\nname="dep"\nversion="1.0.0"\nsource="${source}"\nchecksum="fixture"\n`,
    );

    const bundle = await materializeEvaluationBundle({
      stagedSource,
      attr: "graph-generator",
      classification: "local-development",
      artifactToolsRoot,
      selectorEnv: {},
      devOverrides: {
        NIX_RUST_DEV_OVERRIDE_JSON: JSON.stringify({ [key]: override }),
      },
    });
    const selection = JSON.parse(
      await fsp.readFile(path.join(bundle.bundlePath, "selection.json"), "utf8"),
    );
    assert.equal(
      selection.languageOverrides.NIX_RUST_DEV_OVERRIDE_JSON[key],
      "overrides/NIX_RUST_DEV_OVERRIDE_JSON/0000",
    );
    const registered = await $({ cwd: tmp, stdio: "pipe" })`
      nix store add-path --name source ${bundle.bundlePath}
    `;
    const bundleRoot = String(registered.stdout || "").trim();
    const expression = `
      let
        pkgs = import <nixpkgs> {};
        evaluationBundle =
          import ./viberoots/build-tools/tools/nix/flake/evaluation-bundle.nix {
            repoRoot = builtins.toPath ${JSON.stringify(path.join(bundleRoot, "source"))};
          };
        plan = import ./viberoots/build-tools/tools/nix/templates/rust-patches.nix {
          inherit pkgs;
          cargoLock = builtins.toPath ${JSON.stringify(lock)};
          patchInputs = [];
          vendorAuthorities = {
            ${JSON.stringify(key)} = builtins.toPath ${JSON.stringify(vendor)};
          };
          devOverrides =
            evaluationBundle.languageOverrides.NIX_RUST_DEV_OVERRIDE_JSON;
        };
      in pkgs.runCommand "rust-dev-override-bundle-behavior" {
        nativeBuildInputs = [ pkgs.rustc pkgs.stdenv.cc pkgs.jq pkgs.patch ];
      } ''
        mkdir -p cargo-deps/dep-1.0.0
        cp ${vendor}/{lib.rs,.cargo-checksum.json} cargo-deps/dep-1.0.0/
        cargoDepsCopy="$PWD/cargo-deps"
        ${"${plan.postPatch}"}
        cat > main.rs <<'EOF'
        mod dep { include!("cargo-deps/dep-1.0.0/lib.rs"); }
        fn main() { println!("{}", dep::value()); }
        EOF
        rustc main.rs -o value
        ./value > "$out"
      ''
    `;
    const built = await $({ cwd: tmp, stdio: "pipe" })`
      nix build -L --impure --no-link --print-out-paths --expr ${expression}
    `;
    const output = await fsp.readFile(String(built.stdout || "").trim(), "utf8");
    assert.equal(output.trim(), "41");
    assert.ok(
      String(built.stderr || "").includes(
        `[DEV OVERRIDES ACTIVE] Rust exact fixed source override: ${key}`,
      ),
    );
  });
});
