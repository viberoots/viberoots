#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runInTemp } from "../lib/test-helpers/run-in-temp";

const execFileAsync = promisify(execFile);
const crateName = "fixture-dep";

async function packageVersion(
  cargo: string,
  cargoHome: string,
  owner: string,
  registry: string,
  version: string,
): Promise<{ checksum: string; version: string }> {
  const root = path.join(owner, `${crateName}-${version}`);
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(root, "Cargo.toml"),
    `[package]\nname = "${crateName}"\nversion = "${version}"\nedition = "2021"\nlicense = "MIT"\n`,
  );
  await fsp.writeFile(path.join(root, "src/lib.rs"), `pub const VERSION: &str = "${version}";\n`);
  await execFileAsync(cargo, ["package", "--offline", "--allow-dirty", "--no-verify"], {
    cwd: root,
    env: { PATH: path.dirname(cargo), CARGO_HOME: cargoHome, CARGO_NET_OFFLINE: "true" },
  });
  const archive = await fsp.readFile(
    path.join(root, `target/package/${crateName}-${version}.crate`),
  );
  await fsp.writeFile(path.join(registry, `${crateName}-${version}.crate`), archive);
  return { checksum: createHash("sha256").update(archive).digest("hex"), version };
}

async function writeIndex(
  registry: string,
  versions: Array<{ checksum: string; version: string }>,
) {
  const index = path.join(registry, "index/fi/xt/fixture-dep");
  await fsp.mkdir(path.dirname(index), { recursive: true });
  await fsp.writeFile(
    index,
    `${versions
      .map(({ checksum, version }) =>
        JSON.stringify({
          name: crateName,
          vers: version,
          deps: [],
          cksum: checksum,
          features: {},
          yanked: false,
        }),
      )
      .join("\n")}\n`,
  );
}

function lockedVersion(lock: string): string {
  const match = lock.match(/name = "fixture-dep"\nversion = "([^"]+)"/);
  assert.ok(match, `fixture dependency missing from lock:\n${lock}`);
  return match[1];
}

test("pinned Cargo performs a real offline update against a controlled local registry", async () => {
  await runInTemp("rust-offline-registry", async (root) => {
    const cargo = ensureNixStoreToolPathSync("cargo", {
      PATH: path.join(canonicalArtifactToolsRoot(root), "bin"),
    });
    const cargoHome = path.join(root, ".viberoots/workspace/cargo-home");
    const owner = path.join(root, ".viberoots/workspace/cargo-registry-fixture");
    const registry = path.join(owner, "registry");
    const app = path.join(owner, "consumer");
    await Promise.all(
      [registry, path.join(app, "src")].map((dir) => fsp.mkdir(dir, { recursive: true })),
    );
    const first = await packageVersion(cargo, cargoHome, owner, registry, "1.0.0");
    await writeIndex(registry, [first]);
    await fsp.mkdir(path.join(app, ".cargo"), { recursive: true });
    await fsp.writeFile(
      path.join(app, ".cargo/config.toml"),
      `[source.crates-io]\nreplace-with = "fixture"\n[source.fixture]\nlocal-registry = ${JSON.stringify(registry)}\n`,
    );
    await fsp.writeFile(
      path.join(app, "Cargo.toml"),
      `[package]\nname = "registry-consumer"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nfixture-dep = "1"\n`,
    );
    await fsp.writeFile(
      path.join(app, "src/lib.rs"),
      "pub fn value() -> &'static str { fixture_dep::VERSION }\n",
    );
    const env = { PATH: path.dirname(cargo), CARGO_HOME: cargoHome, CARGO_NET_OFFLINE: "true" };
    await execFileAsync(cargo, ["generate-lockfile", "--offline"], { cwd: app, env });
    assert.equal(lockedVersion(await fsp.readFile(path.join(app, "Cargo.lock"), "utf8")), "1.0.0");

    const second = await packageVersion(cargo, cargoHome, owner, registry, "1.1.0");
    await writeIndex(registry, [first, second]);
    await execFileAsync(cargo, ["update", "--offline", "-p", crateName], { cwd: app, env });
    const upgraded = await fsp.readFile(path.join(app, "Cargo.lock"), "utf8");
    assert.equal(lockedVersion(upgraded), "1.1.0");
    await execFileAsync(cargo, ["metadata", "--locked", "--offline", "--format-version", "1"], {
      cwd: app,
      env,
    });
    // Source replacement intentionally retains crates.io identity in the lock. This is a
    // pinned-Cargo capability fixture only; its synthetic package is never published by u.
    assert.match(
      upgraded,
      /source = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"/,
    );
  });
});

test("pinned Cargo verifies a controlled local Git dependency from workspace cache", async () => {
  await runInTemp("rust-offline-git", async (root) => {
    const toolsBin = path.join(canonicalArtifactToolsRoot(root), "bin");
    const cargo = ensureNixStoreToolPathSync("cargo", { PATH: toolsBin });
    const git = ensureNixStoreToolPathSync("git", { PATH: toolsBin });
    const cargoHome = path.join(root, ".viberoots/workspace/cargo-home");
    const owner = path.join(root, ".viberoots/workspace/cargo-git-fixture");
    const source = path.join(owner, "source");
    const app = path.join(owner, "consumer");
    await Promise.all(
      [path.join(source, "src"), path.join(app, "src")].map(
        async (dir) => await fsp.mkdir(dir, { recursive: true }),
      ),
    );
    await fsp.writeFile(
      path.join(source, "Cargo.toml"),
      '[package]\nname = "git-fixture-dep"\nversion = "1.0.0"\nedition = "2021"\n',
    );
    await fsp.writeFile(path.join(source, "src/lib.rs"), "pub const VALUE: u8 = 1;\n");
    await execFileAsync(git, ["init", "-q", "--initial-branch=main"], { cwd: source });
    await execFileAsync(git, ["add", "."], { cwd: source });
    await execFileAsync(
      git,
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
      { cwd: source },
    );
    await fsp.writeFile(
      path.join(app, "Cargo.toml"),
      `[package]\nname = "git-consumer"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\ngit-fixture-dep = { git = ${JSON.stringify(`file://${source}`)} }\n`,
    );
    await fsp.writeFile(
      path.join(app, "src/lib.rs"),
      "pub fn value() -> u8 { git_fixture_dep::VALUE }\n",
    );
    const seedEnv = { PATH: toolsBin, CARGO_HOME: cargoHome };
    await execFileAsync(cargo, ["generate-lockfile"], { cwd: app, env: seedEnv });
    const lock = await fsp.readFile(path.join(app, "Cargo.lock"), "utf8");
    assert.match(lock, /source = "git\+file:\/\/.*#[0-9a-f]{40}"/);
    await fsp.rename(source, `${source}.unavailable`);
    await execFileAsync(cargo, ["metadata", "--locked", "--offline", "--format-version", "1"], {
      cwd: app,
      env: { ...seedEnv, CARGO_NET_OFFLINE: "true" },
    });
  });
});
