#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { rustPatchFilename } from "../../patch/rust-sync-required";
import { runInTemp } from "../lib/test-helpers";
import { runRealGitVendorBoundary } from "./rust.real-git-vendor-boundary.helpers";
import { runRealPrivateRegistryBoundary } from "./rust.real-private-registry-boundary.helpers";

type Dependency = {
  id: string;
  name: string;
  version: string;
  source: string;
  checksum?: string;
  initial: number;
  patched: number;
  vendorName: string;
};

const dependencies: Dependency[] = [
  {
    id: "crates_dep",
    name: "crates_dep",
    version: "1.0.0",
    source: "registry+https://github.com/rust-lang/crates.io-index",
    checksum: "crates-checksum",
    initial: 1,
    patched: 2,
    vendorName: "crates_dep-1.0.0",
  },
  {
    id: "git_dep_a",
    name: "git_dep",
    version: "2.0.0",
    source: `git+https://git.example/private/dep?branch=main#${"a".repeat(40)}`,
    initial: 11,
    patched: 12,
    vendorName: "git_dep-2.0.0-revision-a",
  },
  {
    id: "git_dep_b",
    name: "git_dep",
    version: "2.0.0",
    source: `git+https://git.example/private/dep?branch=next#${"b".repeat(40)}`,
    initial: 13,
    patched: 14,
    vendorName: "git_dep-2.0.0-revision-b",
  },
  {
    id: "private_dep",
    name: "private_dep",
    version: "3.0.0",
    source: "registry+https://registry.example/private-index",
    checksum: "private-checksum",
    initial: 21,
    patched: 22,
    vendorName: "private_dep-3.0.0",
  },
  {
    id: "replaced_dep",
    name: "replaced_dep",
    version: "4.0.0",
    source: "registry+https://registry.original.example/index",
    checksum: "replacement-checksum",
    initial: 31,
    patched: 32,
    vendorName: "replaced_dep-4.0.0-source-replaced",
  },
];

function lockEntry(dependency: Dependency): string {
  const checksum = dependency.checksum ? `\nchecksum="${dependency.checksum}"` : "";
  return `[[package]]\nname="${dependency.name}"\nversion="${dependency.version}"\nsource="${dependency.source}"${checksum}\n`;
}

test("Rust Nix patching executes for registry, Git, private, and source-replaced identities", async () => {
  await runInTemp("rust-patch-compiled", async (tmp, $) => {
    const owner = path.join(tmp, "fixture");
    const sources = path.join(owner, "sources");
    const unrelated = path.join(owner, "unrelated");
    const patchDir = path.join(owner, "patches");
    await Promise.all(
      [sources, unrelated, patchDir].map((directory) => fsp.mkdir(directory, { recursive: true })),
    );
    await fsp.writeFile(path.join(unrelated, "lib.rs"), "pub fn value() -> u8 { 7 }\n");
    for (const dependency of dependencies) {
      const sourceRoot = path.join(sources, dependency.id);
      await fsp.mkdir(sourceRoot);
      await fsp.writeFile(
        path.join(sourceRoot, "lib.rs"),
        `pub fn value() -> u8 { ${dependency.initial} }\n`,
      );
      await fsp.writeFile(
        path.join(
          patchDir,
          rustPatchFilename(dependency.name, dependency.version, dependency.source),
        ),
        [
          "diff --git a/lib.rs b/lib.rs",
          "--- a/lib.rs",
          "+++ b/lib.rs",
          "@@ -1 +1 @@",
          `-pub fn value() -> u8 { ${dependency.initial} }`,
          `+pub fn value() -> u8 { ${dependency.patched} }`,
          "",
        ].join("\n"),
      );
    }
    const lock = path.join(owner, "Cargo.lock");
    await fsp.writeFile(lock, `version=3\n${dependencies.map(lockEntry).join("")}`);

    const copyCommands = dependencies
      .map((dependency) => {
        return [
          `mkdir -p vendor/${dependency.vendorName}`,
          `cp ${path.join(sources, dependency.id)}/lib.rs vendor/${dependency.vendorName}/`,
          `printf '%s\\n' ${JSON.stringify(
            JSON.stringify({
              files: {},
              package: dependency.source.startsWith("git+") ? null : dependency.checksum,
            }),
          )} > vendor/${dependency.vendorName}/.cargo-checksum.json`,
        ].join("\n");
      })
      .join("\n");
    const modules = dependencies
      .map((dependency) => {
        return `mod ${dependency.id} { include!("vendor/${dependency.vendorName}/lib.rs"); }`;
      })
      .join("\n");
    const values = dependencies.map((dependency) => `${dependency.id}::value()`).join(", ");
    const vendorAuthorities = dependencies
      .map(
        (dependency) =>
          `${JSON.stringify(
            `${dependency.name.toLowerCase()}@${dependency.version}#${dependency.source}`,
          )} = builtins.toPath ${JSON.stringify(path.join(sources, dependency.id))};`,
      )
      .join("\n");
    const expression = (authorities = vendorAuthorities, extraVendor = "") => `
      let
        pkgs = import <nixpkgs> {};
        plan = import ./viberoots/build-tools/tools/nix/templates/rust-patches.nix {
          inherit pkgs;
          cargoLock = builtins.toPath ${JSON.stringify(lock)};
          patchInputs = [ (builtins.toPath ${JSON.stringify(patchDir)}) ];
          vendorAuthorities = { ${authorities} };
        };
      in pkgs.runCommand "rust-patch-compiled-behavior" {
        nativeBuildInputs = [ pkgs.rustc pkgs.stdenv.cc pkgs.jq pkgs.patch ];
      } ''
        ${copyCommands}
        ${extraVendor}
        cargoDepsCopy="$PWD/vendor"
        ${"${plan.postPatch}"}
        printf '%s\n' '${modules}' \
          'fn main() { println!("{:?}", (${values})); }' > main.rs
        rustc main.rs -o value
        mkdir -p unrelated
        cp ${unrelated}/lib.rs unrelated/lib.rs
        printf '%s\n' \
          'mod dep { include!("unrelated/lib.rs"); }' \
          'fn main() { println!("{}", dep::value()); }' > unrelated.rs
        rustc unrelated.rs -o unrelated-value
        { ./value; ./unrelated-value; } > "$out"
      ''
    `;
    const build = async (authorities?: string, extraVendor?: string) => {
      const result = await $({ cwd: tmp, stdio: "pipe" })`
        nix build -L --impure --no-link --print-out-paths --expr \
          ${expression(authorities, extraVendor)}
      `;
      return await fsp.readFile(String(result.stdout).trim(), "utf8");
    };
    const failedBuild = async (authorities?: string, extraVendor?: string) =>
      await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        nix build -L --impure --no-link --print-out-paths --expr \
          ${expression(authorities, extraVendor)}
      `;
    assert.equal((await build()).trim(), "(2, 12, 14, 22, 32)\n7");
    assert.equal(
      await fsp.readFile(path.join(unrelated, "lib.rs"), "utf8"),
      "pub fn value() -> u8 { 7 }\n",
    );
    const mismatchedAuthorities = vendorAuthorities.replace(
      JSON.stringify(path.join(sources, dependencies[1]!.id)),
      JSON.stringify(unrelated),
    );
    const mismatched = await failedBuild(mismatchedAuthorities);
    assert.notEqual(mismatched.exitCode, 0);
    assert.match(String(mismatched.stderr), /expected one exact vendored identity, found 0/);
    const duplicated = await failedBuild(
      undefined,
      `cp -R vendor/${dependencies[1]!.vendorName} vendor/duplicate-git-authority`,
    );
    assert.notEqual(duplicated.exitCode, 0);
    assert.match(String(duplicated.stderr), /expected one exact vendored identity, found 2/);
    await fsp.rm(
      path.join(
        patchDir,
        rustPatchFilename(dependencies[2]!.name, dependencies[2]!.version, dependencies[2]!.source),
      ),
    );
    assert.equal((await build()).trim(), "(2, 12, 13, 22, 32)\n7");
    await Promise.all(
      dependencies.map((dependency) =>
        fsp.rm(
          path.join(
            patchDir,
            rustPatchFilename(dependency.name, dependency.version, dependency.source),
          ),
          { force: true },
        ),
      ),
    );
    assert.equal((await build()).trim(), "(1, 11, 13, 21, 31)\n7");
  });
});

test("Rust patches a real buildRustPackage Git vendor boundary without matching metadata", async () => {
  await runInTemp("rust-real-git-vendor", async (tmp) => await runRealGitVendorBoundary(tmp));
});

test("Rust patches a pre-materialized private registry boundary offline", async () => {
  await runInTemp(
    "rust-real-private-registry",
    async (tmp) => await runRealPrivateRegistryBoundary(tmp),
  );
});
