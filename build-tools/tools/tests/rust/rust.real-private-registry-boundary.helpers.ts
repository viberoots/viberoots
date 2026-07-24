import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { rustPatchFilename } from "../../patch/rust-sync-required";

function run(command: string, args: string[], cwd: string, env = process.env): string {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

async function registryPackage(root: string, name: string, value: number): Promise<void> {
  const manifest = `[package]\nname="${name}"\nversion="1.0.0"\nedition="2021"\n`;
  const library = `pub fn value() -> u8 { ${value} }\n`;
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.writeFile(path.join(root, "Cargo.toml"), manifest);
  await fsp.writeFile(path.join(root, "src/lib.rs"), library);
  await fsp.writeFile(
    path.join(root, ".cargo-checksum.json"),
    `${JSON.stringify({
      files: {
        "Cargo.toml": crypto.createHash("sha256").update(manifest).digest("hex"),
        "src/lib.rs": crypto.createHash("sha256").update(library).digest("hex"),
      },
      package: crypto.createHash("sha256").update(`${name} crate archive`).digest("hex"),
    })}\n`,
  );
}

export async function runRealPrivateRegistryBoundary(tmp: string): Promise<void> {
  const source = "registry+https://registry.example.invalid/private-index";
  const app = path.join(tmp, "private-registry-app");
  const patchDir = path.join(app, "patches/rust");
  const depA = path.join(tmp, "private_dep_a");
  const depB = path.join(tmp, "private_dep_b");
  await Promise.all([
    fsp.mkdir(path.join(app, "src"), { recursive: true }),
    fsp.mkdir(patchDir, { recursive: true }),
    registryPackage(depA, "private_dep_a", 61),
    registryPackage(depB, "private_dep_b", 71),
  ]);
  await fsp.writeFile(
    path.join(app, "Cargo.toml"),
    [
      "[package]",
      'name="private_registry_app"',
      'version="0.1.0"',
      'edition="2021"',
      "[dependencies]",
      'dep_a={package="private_dep_a",version="=1.0.0",registry="private"}',
      'dep_b={package="private_dep_b",version="=1.0.0",registry="private"}',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(app, "src/main.rs"),
    'fn main() { println!("{},{}", dep_a::value(), dep_b::value()); }\n',
  );
  const lock = path.join(app, "Cargo.lock");
  await fsp.writeFile(
    lock,
    [
      "version = 3",
      '[[package]]\nname = "private_registry_app"\nversion = "0.1.0"\ndependencies = [\n "private_dep_a",\n "private_dep_b",\n]',
      `[[package]]\nname = "private_dep_a"\nversion = "1.0.0"\nsource = "${source}"\nchecksum = "${crypto.createHash("sha256").update("private_dep_a crate archive").digest("hex")}"`,
      `[[package]]\nname = "private_dep_b"\nversion = "1.0.0"\nsource = "${source}"\nchecksum = "${crypto.createHash("sha256").update("private_dep_b crate archive").digest("hex")}"`,
      "",
    ].join("\n"),
  );
  const fixedEntry = (packageRoot: string, name: string) => {
    const storePath = run(
      "nix",
      ["store", "add-path", "--name", `${name}-fixed`, packageRoot],
      tmp,
    );
    return {
      source,
      checksum: crypto.createHash("sha256").update(`${name} crate archive`).digest("hex"),
      storePath,
      narHash: run("nix", ["hash", "path", "--sri", storePath], tmp),
      registryName: "private",
    };
  };
  const fixedSources = {
    [`private_dep_a@1.0.0#${source}`]: fixedEntry(depA, "private_dep_a"),
    [`private_dep_b@1.0.0#${source}`]: fixedEntry(depB, "private_dep_b"),
  };
  const patch = path.join(patchDir, rustPatchFilename("private_dep_a", "1.0.0", source));
  await fsp.writeFile(
    patch,
    [
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@ -1 +1 @@",
      "-pub fn value() -> u8 { 61 }",
      "+pub fn value() -> u8 { 62 }",
      "",
    ].join("\n"),
  );
  const expression = (sources = fixedSources) => `
    let
      pkgs = import <nixpkgs> {};
      cargoRoot = builtins.path { path = ${JSON.stringify(app)}; name = "private-registry-app"; };
      vendor = import ./viberoots/build-tools/tools/nix/templates/rust-vendor.nix {
        inherit pkgs cargoRoot;
        cargoLock = builtins.toPath ${JSON.stringify(lock)};
        cargoFixedSources = builtins.fromJSON ${JSON.stringify(JSON.stringify(sources))};
      };
      plan = import ./viberoots/build-tools/tools/nix/templates/rust-patches.nix {
        inherit pkgs;
        cargoLock = builtins.toPath ${JSON.stringify(lock)};
        patchInputs = [ (builtins.path {
          path = ${JSON.stringify(patchDir)};
          name = "private-registry-patches";
        }) ];
        vendorAuthorities = vendor.vendorAuthorities;
      };
    in pkgs.rustPlatform.buildRustPackage {
      pname = "private-registry-boundary";
      version = "0.1.0";
      src = vendor.sourceWithVendor;
      cargoVendorDir = ".viberoots-cargo-vendor";
      postPatch = plan.postPatch;
      doCheck = false;
    }
  `;
  const credential = "must-not-enter-private-registry-derivation";
  const evalFailure = (sources: typeof fixedSources) => {
    try {
      run(
        "nix",
        ["build", "--impure", "--no-link", "--expr", expression(sources)],
        tmp,
        process.env,
      );
      assert.fail("expected private registry authority evaluation to fail");
    } catch (error) {
      return String((error as { stderr?: string }).stderr || error);
    }
  };
  assert.match(evalFailure({}), /alternate registry materialization is unavailable/);
  assert.match(
    evalFailure({
      ...fixedSources,
      [`private_dep_a@1.0.0#${source}`]: {
        ...fixedSources[`private_dep_a@1.0.0#${source}`],
        originPath: depA,
      },
    }),
    /unsupported or ambient inputs/,
  );
  assert.match(
    evalFailure({
      ...fixedSources,
      [`private_dep_a@1.0.0#${source}`]: {
        ...fixedSources[`private_dep_a@1.0.0#${source}`],
        checksum: "wrong-checksum",
      },
    }),
    /materialization identity does not match Cargo\.lock/,
  );
  assert.match(
    evalFailure({
      ...fixedSources,
      [`private_dep_a@1.0.0#${source}`]: {
        ...fixedSources[`private_dep_a@1.0.0#${source}`],
        narHash: `sha256-${"A".repeat(43)}=`,
      },
    }),
    /hash mismatch|store path mismatch|specified.*sha256-/i,
  );
  const buildAndRun = () => {
    const output = run(
      "nix",
      ["build", "-L", "--impure", "--no-link", "--print-out-paths", "--expr", expression()],
      tmp,
      { ...process.env, CARGO_REGISTRIES_PRIVATE_TOKEN: credential },
    );
    assert.doesNotMatch(output, new RegExp(credential));
    return run(path.join(output, "bin/private_registry_app"), [], tmp);
  };
  assert.equal(buildAndRun(), "62,71");
  await fsp.rm(patch);
  assert.equal(buildAndRun(), "61,71");
}
