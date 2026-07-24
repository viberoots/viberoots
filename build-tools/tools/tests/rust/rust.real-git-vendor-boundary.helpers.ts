import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { materializeFixedSources } from "../../dev/install/cargo-fixed-sources";
import { readCargoPackages } from "../../patch/rust-lock";
import { rustPatchFilename } from "../../patch/rust-sync-required";

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

async function createDependency(
  directory: string,
  value: number,
): Promise<{ revision: string; packageRoot: string }> {
  const packageRoot = path.join(directory, "crate");
  await fsp.mkdir(path.join(packageRoot, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(directory, "Cargo.toml"),
    '[workspace]\nmembers=["crate"]\nresolver="2"\n[workspace.package]\nversion="1.0.0"\nedition="2021"\nlicense="MIT"\n',
  );
  await fsp.writeFile(
    path.join(packageRoot, "Cargo.toml"),
    '[package]\nname="real_git_dep"\nversion.workspace=true\nedition.workspace=true\nlicense.workspace=true\n',
  );
  await fsp.writeFile(path.join(packageRoot, "src/lib.rs"), `pub fn value() -> u8 { ${value} }\n`);
  run("git", ["init", "-q"], directory);
  run("git", ["config", "user.email", "fixture@example.invalid"], directory);
  run("git", ["config", "user.name", "Fixture"], directory);
  run("git", ["add", "."], directory);
  run("git", ["commit", "-qm", "fixture"], directory);
  return {
    revision: run("git", ["rev-parse", "HEAD"], directory),
    packageRoot,
  };
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export async function runRealGitVendorBoundary(tmp: string): Promise<void> {
  const dependencyA = path.join(tmp, "real-git-dependency-a");
  const dependencyB = path.join(tmp, "real-git-dependency-b");
  const app = path.join(tmp, "real-git-app");
  const patchDir = path.join(app, "patches/rust");
  await Promise.all(
    [path.join(app, "src"), patchDir].map((directory) => fsp.mkdir(directory, { recursive: true })),
  );
  const [dependencyInfoA, dependencyInfoB] = await Promise.all([
    createDependency(dependencyA, 41),
    createDependency(dependencyB, 51),
  ]);
  const { revision: revisionA, packageRoot: packageRootA } = dependencyInfoA;
  const { revision: revisionB, packageRoot: packageRootB } = dependencyInfoB;
  const port = await availablePort();
  const daemon = spawn(
    "git",
    [
      "daemon",
      "--reuseaddr",
      "--export-all",
      `--base-path=${tmp}`,
      "--listen=127.0.0.1",
      `--port=${port}`,
      tmp,
    ],
    { stdio: "ignore" },
  );
  const gitUrlA = `git://127.0.0.1:${port}/real-git-dependency-a`;
  const gitUrlB = `git://127.0.0.1:${port}/real-git-dependency-b`;
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        run("git", ["ls-remote", gitUrlA], tmp);
        break;
      } catch {
        if (attempt === 19) throw new Error("Git fixture daemon did not start");
      }
    }
    await fsp.writeFile(
      path.join(app, "Cargo.toml"),
      [
        "[package]",
        'name="real_git_app"',
        'version="0.1.0"',
        'edition="2021"',
        "[dependencies]",
        `dep_a={package="real_git_dep",git=${JSON.stringify(gitUrlA)},rev=${JSON.stringify(revisionA)}}`,
        `dep_b={package="real_git_dep",git=${JSON.stringify(gitUrlB)},rev=${JSON.stringify(revisionB)}}`,
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(app, "src/main.rs"),
      'fn main() { println!("{},{}", dep_a::value(), dep_b::value()); }\n',
    );
    run("cargo", ["generate-lockfile"], app);
    const lock = path.join(app, "Cargo.lock");
    const locked = (await readCargoPackages(lock)).filter((pkg) => pkg.name === "real_git_dep");
    assert.equal(locked.length, 2);
    const lockedA = locked.find((pkg) => pkg.source.includes("real-git-dependency-a"));
    const lockedB = locked.find((pkg) => pkg.source.includes("real-git-dependency-b"));
    assert.ok(lockedA);
    assert.ok(lockedB);
    const keyA = `${lockedA.name.toLowerCase()}@${lockedA.version}#${lockedA.source}`;
    const keyB = `${lockedB.name.toLowerCase()}@${lockedB.version}#${lockedB.source}`;
    const materialized = await materializeFixedSources(
      {
        [keyA]: { originPath: packageRootA, source: lockedA.source, checksum: "" },
        [keyB]: { originPath: packageRootB, source: lockedB.source, checksum: "" },
      },
      async (key, entry) => {
        const storePath = run(
          "nix",
          [
            "store",
            "add-path",
            "--name",
            `${key === keyA ? "git-a" : "git-b"}-fixed`,
            entry.originPath,
          ],
          tmp,
        );
        return {
          storePath,
          narHash: run("nix", ["hash", "path", "--sri", storePath], tmp),
        };
      },
      async (command, args, cwd) => run(command, args, cwd),
    );
    const fixedSources = {
      [keyA]: materialized[keyA]!.buildInput!,
      [keyB]: materialized[keyB]!.buildInput!,
    };
    await fsp.rm(dependencyA, { recursive: true, force: true });
    await fsp.rm(dependencyB, { recursive: true, force: true });
    const patch = path.join(
      patchDir,
      rustPatchFilename(lockedA.name, lockedA.version, lockedA.source),
    );
    await fsp.writeFile(
      patch,
      [
        "diff --git a/src/lib.rs b/src/lib.rs",
        "--- a/src/lib.rs",
        "+++ b/src/lib.rs",
        "@@ -1 +1 @@",
        "-pub fn value() -> u8 { 41 }",
        "+pub fn value() -> u8 { 42 }",
        "",
      ].join("\n"),
    );
    const expression = () => `
    let
      pkgs = import <nixpkgs> {};
      cargoRoot = builtins.path {
        path = ${JSON.stringify(app)};
        name = "real-git-app-source";
      };
      vendor = import ./viberoots/build-tools/tools/nix/templates/rust-vendor.nix {
        inherit pkgs cargoRoot;
        cargoLock = builtins.toPath ${JSON.stringify(lock)};
        cargoFixedSources = builtins.fromJSON ${JSON.stringify(JSON.stringify(fixedSources))};
      };
      plan = import ./viberoots/build-tools/tools/nix/templates/rust-patches.nix {
        inherit pkgs;
        cargoLock = builtins.toPath ${JSON.stringify(lock)};
        patchInputs = [ (builtins.path {
          path = ${JSON.stringify(patchDir)};
          name = "real-git-patches";
        }) ];
        vendorAuthorities = vendor.vendorAuthorities;
      };
    in pkgs.rustPlatform.buildRustPackage {
      pname = "real-git-vendor-boundary";
      version = "0.1.0";
      src = vendor.sourceWithVendor;
      cargoVendorDir = ".viberoots-cargo-vendor";
      postPatch = plan.postPatch;
      doCheck = false;
    }
  `;
    const buildAndRun = () => {
      const output = run(
        "nix",
        ["build", "-L", "--impure", "--no-link", "--print-out-paths", "--expr", expression()],
        tmp,
      );
      return run(path.join(output, "bin/real_git_app"), [], tmp);
    };
    assert.equal(buildAndRun(), "42,51");
    await fsp.rm(patch);
    assert.equal(buildAndRun(), "41,51");
  } finally {
    daemon.kill();
  }
}
