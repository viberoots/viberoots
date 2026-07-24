#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cargoPackageKey, type CargoPackage } from "../../patch/rust-lock";
import { resolveRustPackageOrigin } from "../../patch/rust-source";

test("Rust authoring resolves only exact reviewed registry and Git fixed-source identities", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-"));
  const previous = process.env.NIX_RUST_TEST_RESOLVE_JSON;
  try {
    const cargoRoot = path.join(root, "cargo-root");
    const cratesOrigin = path.join(root, "crates-origin");
    const privateOrigin = path.join(root, "private-origin");
    const gitOrigin = path.join(root, "git-origin");
    await Promise.all(
      [cargoRoot, cratesOrigin, privateOrigin, gitOrigin].map((dir) =>
        fsp.mkdir(dir, { recursive: true }),
      ),
    );
    await fsp.writeFile(
      path.join(cratesOrigin, ".cargo-checksum.json"),
      JSON.stringify({ package: "checksum-crates", files: {} }),
    );
    await fsp.writeFile(
      path.join(privateOrigin, ".cargo-checksum.json"),
      JSON.stringify({ package: "checksum-private", files: {} }),
    );
    await fsp.mkdir(path.join(gitOrigin, "src"));
    await fsp.writeFile(
      path.join(gitOrigin, "Cargo.toml"),
      '[package]\nname="git-dep"\nversion="2.0.0"\n',
    );
    await fsp.writeFile(path.join(gitOrigin, "src/lib.rs"), "pub fn value() -> u8 { 1 }\n");
    execFileSync("git", ["init", "-q", gitOrigin]);
    execFileSync("git", ["-C", gitOrigin, "config", "user.email", "fixture@example.invalid"]);
    execFileSync("git", ["-C", gitOrigin, "config", "user.name", "Fixture"]);
    execFileSync("git", ["-C", gitOrigin, "add", "."]);
    execFileSync("git", ["-C", gitOrigin, "commit", "-qm", "fixture"]);
    const revision = execFileSync("git", ["-C", gitOrigin, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    await assert.rejects(fsp.access(path.join(gitOrigin, ".cargo_vcs_info.json")));
    const packages: CargoPackage[] = [
      {
        name: "same",
        version: "1.0.0",
        source: "registry+https://github.com/rust-lang/crates.io-index",
        checksum: "checksum-crates",
      },
      {
        name: "same",
        version: "1.0.0",
        source: "registry+https://private.example/index",
        checksum: "checksum-private",
      },
      {
        name: "git-dep",
        version: "2.0.0",
        source: `git+https://example.com/repo.git#${revision}`,
        checksum: "",
      },
    ];
    const storePaths = [cratesOrigin, privateOrigin, gitOrigin].map((origin, index) => {
      const storePath = execFileSync(
        "nix",
        ["store", "add-path", "--name", `rust-source-identity-${index}`, origin],
        { encoding: "utf8" },
      ).trim();
      return {
        storePath,
        narHash: execFileSync("nix", ["hash", "path", "--sri", storePath], {
          encoding: "utf8",
        }).trim(),
      };
    });
    process.env.NIX_RUST_TEST_RESOLVE_JSON = JSON.stringify(
      Object.fromEntries(
        packages.map((pkg, index) => [
          cargoPackageKey(pkg),
          (() => {
            const { storePath, narHash } = storePaths[index]!;
            return {
              originPath: [cratesOrigin, privateOrigin, gitOrigin][index],
              source: pkg.source,
              checksum: pkg.checksum,
              storePath,
              narHash,
              buildInput: {
                source: pkg.source,
                checksum: pkg.checksum,
                storePath,
                narHash,
              },
            };
          })(),
        ]),
      ),
    );
    assert.equal(await resolveRustPackageOrigin(cargoRoot, packages[0]!), storePaths[0]!.storePath);
    assert.equal(await resolveRustPackageOrigin(cargoRoot, packages[1]!), storePaths[1]!.storePath);
    assert.equal(await resolveRustPackageOrigin(cargoRoot, packages[2]!), storePaths[2]!.storePath);
    await fsp.writeFile(path.join(privateOrigin, ".cargo-checksum.json"), "{}");
    await fsp.rm(gitOrigin, { recursive: true, force: true });
    assert.equal(await resolveRustPackageOrigin(cargoRoot, packages[1]!), storePaths[1]!.storePath);
    assert.equal(await resolveRustPackageOrigin(cargoRoot, packages[2]!), storePaths[2]!.storePath);
    assert.equal(
      await fsp.readFile(path.join(storePaths[2]!.storePath, "src/lib.rs"), "utf8"),
      "pub fn value() -> u8 { 1 }\n",
    );

    process.env.NIX_RUST_TEST_RESOLVE_JSON = JSON.stringify({
      "same@1.0.0": {
        originPath: cratesOrigin,
        source: packages[0]!.source,
        checksum: packages[0]!.checksum,
      },
    });
    await assert.rejects(
      resolveRustPackageOrigin(cargoRoot, packages[0]!),
      /exact Nix fixed source is unavailable/,
    );
    process.env.NIX_RUST_TEST_RESOLVE_JSON = JSON.stringify({
      [cargoPackageKey(packages[0]!)]: {
        originPath: cratesOrigin,
        source: packages[0]!.source,
        checksum: packages[0]!.checksum,
        ...storePaths[0],
        buildInput: {
          source: packages[0]!.source,
          checksum: packages[0]!.checksum,
          storePath: storePaths[1]!.storePath,
          narHash: storePaths[0]!.narHash,
        },
      },
    });
    await assert.rejects(
      resolveRustPackageOrigin(cargoRoot, packages[0]!),
      /exact Nix fixed source is unavailable/,
    );
  } finally {
    if (previous === undefined) delete process.env.NIX_RUST_TEST_RESOLVE_JSON;
    else process.env.NIX_RUST_TEST_RESOLVE_JSON = previous;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
