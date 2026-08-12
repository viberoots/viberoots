#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { materializeFixedSources } from "../../dev/install/cargo-fixed-sources";

const exec = promisify(execFile);

async function run(command: string, args: string[], cwd: string): Promise<string> {
  return (await exec(command, args, { cwd, encoding: "utf8" })).stdout.trim();
}

test("Git fixed sources reconstruct the full locked revision into one immutable authority", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-git-integrity-"));
  try {
    const packageRoot = path.join(root, "crates/git_dep");
    await fsp.mkdir(path.join(packageRoot, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(packageRoot, "Cargo.toml"),
      '[package]\nname="git_dep" # valid trailing comment\nversion="1.0.0" # exact\nedition="2021"\n',
    );
    await fsp.writeFile(path.join(packageRoot, "src/lib.rs"), "pub fn value() -> u8 { 7 }\n");
    await run("git", ["init", "-q"], root);
    await run("git", ["config", "user.email", "fixture@example.invalid"], root);
    await run("git", ["config", "user.name", "Fixture"], root);
    await run("git", ["add", "."], root);
    await run("git", ["commit", "-qm", "fixture"], root);
    const revision = await run("git", ["rev-parse", "HEAD"], root);
    const source = `git+https://example.invalid/repository?rev=${revision}#${revision}`;
    const key = `git_dep@1.0.0#${source}`;
    const fixed = await materializeFixedSources(
      {
        [key]: { originPath: packageRoot, source, checksum: "" },
      },
      async (_key, entry) => {
        assert.notEqual(entry.originPath, packageRoot);
        assert.equal(
          await fsp.readFile(path.join(entry.originPath, "src/lib.rs"), "utf8"),
          "pub fn value() -> u8 { 7 }\n",
        );
        const storePath = await run(
          "nix",
          ["store", "add-path", "--name", "git-integrity-fixed", entry.originPath],
          root,
        );
        return {
          storePath,
          narHash: await run("nix", ["hash", "path", "--sri", storePath], root),
        };
      },
      run,
    );
    await fsp.writeFile(path.join(packageRoot, "src/lib.rs"), "tampered\n");
    await fsp.rm(root, { recursive: true, force: true });
    const authority = fixed[key]!.buildInput!;
    assert.equal(
      await fsp.readFile(path.join(authority.storePath, "src/lib.rs"), "utf8"),
      "pub fn value() -> u8 { 7 }\n",
    );
    assert.equal(fixed[key]!.storePath, authority.storePath);
    assert.equal(fixed[key]!.narHash, authority.narHash);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("fixed-source production materialization batches immutable path hashing", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-git-batch-hash-"));
  try {
    const packages = ["dep_a", "dep_b"];
    for (const name of packages) {
      const packageRoot = path.join(root, "crates", name);
      await fsp.mkdir(path.join(packageRoot, "src"), { recursive: true });
      await fsp.writeFile(
        path.join(packageRoot, "Cargo.toml"),
        `[package]\nname="${name}"\nversion="1.0.0"\nedition="2021"\n`,
      );
      await fsp.writeFile(path.join(packageRoot, "src/lib.rs"), `pub fn ${name}() {}\n`);
    }
    await run("git", ["init", "-q"], root);
    await run("git", ["config", "user.email", "fixture@example.invalid"], root);
    await run("git", ["config", "user.name", "Fixture"], root);
    await run("git", ["add", "."], root);
    await run("git", ["commit", "-qm", "fixture"], root);
    const revision = await run("git", ["rev-parse", "HEAD"], root);
    const source = `git+https://example.invalid/repository#${revision}`;
    const keys = packages.map((name) => `${name}@1.0.0#${source}`);
    const added: string[] = [];
    const storePathsByKey = new Map(
      keys.map((key, index) => [key, `/nix/store/deferred-${index + 1}`]),
    );
    const hashCalls: string[][] = [];
    const fixed = await materializeFixedSources(
      Object.fromEntries(
        packages.map((name, index) => [
          keys[index],
          { originPath: path.join(root, "crates", name), source, checksum: "" },
        ]),
      ),
      async () => {
        throw new Error("per-source materializer must not run");
      },
      run,
      undefined,
      {
        add: async (key, entry) => {
          assert.match(
            await fsp.readFile(path.join(entry.originPath, "Cargo.toml"), "utf8"),
            /1\.0\.0/u,
          );
          added.push(key);
          return { storePath: storePathsByKey.get(key)! };
        },
        hash: async (storePaths) => {
          hashCalls.push(storePaths);
          return storePaths.map((_storePath, index) => `sha256-batch-${index + 1}`);
        },
      },
    );
    assert.deepEqual([...added].sort(), [...keys].sort());
    assert.deepEqual(hashCalls, [["/nix/store/deferred-1", "/nix/store/deferred-2"]]);
    assert.equal(fixed[keys[0]!]!.narHash, "sha256-batch-1");
    assert.equal(fixed[keys[1]!]!.narHash, "sha256-batch-2");
    assert.deepEqual(Object.keys(fixed), keys);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Git fixed sources resolve workspace-inherited package versions through Cargo metadata", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-git-workspace-integrity-"));
  try {
    const packageRoot = path.join(root, "crates/workspace_dep");
    await fsp.mkdir(path.join(packageRoot, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "Cargo.toml"),
      '[workspace]\nmembers=["crates/workspace_dep"]\n[workspace.package]\nversion="2.3.4"\nedition="2021"\n',
    );
    await fsp.writeFile(
      path.join(packageRoot, "Cargo.toml"),
      '[package]\nname="workspace_dep"\nversion.workspace=true\nedition.workspace=true\n',
    );
    await fsp.writeFile(path.join(packageRoot, "src/lib.rs"), "pub fn value() {}\n");
    await run("git", ["init", "-q"], root);
    await run("git", ["config", "user.email", "fixture@example.invalid"], root);
    await run("git", ["config", "user.name", "Fixture"], root);
    await run("git", ["add", "."], root);
    await run("git", ["commit", "-qm", "workspace fixture"], root);
    const revision = await run("git", ["rev-parse", "HEAD"], root);
    const source = `git+https://example.invalid/workspace#${revision}`;
    const key = `workspace_dep@2.3.4#${source}`;
    let observed = "";
    await materializeFixedSources(
      { [key]: { originPath: packageRoot, source, checksum: "" } },
      async (_key, entry) => {
        observed = await fsp.readFile(path.join(entry.originPath, "Cargo.toml"), "utf8");
        return { storePath: "/nix/store/workspace-authority", narHash: "sha256-workspace" };
      },
      run,
    );
    assert.match(observed, /version = "2\.3\.4"/);
    assert.match(observed, /edition = "2021"/);

    const ambiguousRun = async (command: string, args: string[], cwd: string) => {
      if (command !== "cargo") return await run(command, args, cwd);
      const manifest = args[args.indexOf("--manifest-path") + 1] || "";
      const pkg = { manifest_path: manifest, name: "workspace_dep", version: "2.3.4" };
      return JSON.stringify({ packages: [pkg, pkg] });
    };
    await assert.rejects(
      materializeFixedSources(
        { [key]: { originPath: packageRoot, source, checksum: "" } },
        async () => ({ storePath: "/nix/store/unreachable", narHash: "sha256-x" }),
        ambiguousRun,
      ),
      /ambiguous canonical metadata/,
    );

    await fsp.writeFile(path.join(root, "Cargo.toml"), "[workspace]\nmembers=[7]\n");
    await run("git", ["add", "Cargo.toml"], root);
    await run("git", ["commit", "-qm", "malformed workspace"], root);
    const malformedRevision = await run("git", ["rev-parse", "HEAD"], root);
    const malformedSource = `git+https://example.invalid/workspace#${malformedRevision}`;
    await assert.rejects(
      materializeFixedSources(
        {
          [`workspace_dep@2.3.4#${malformedSource}`]: {
            originPath: packageRoot,
            source: malformedSource,
            checksum: "",
          },
        },
        async () => ({ storePath: "/nix/store/unreachable", narHash: "sha256-x" }),
        run,
      ),
      /Command failed|metadata/i,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Git fixed sources reject mismatched revisions and package identities", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-git-integrity-reject-"));
  try {
    await fsp.mkdir(path.join(root, "src"));
    await fsp.writeFile(
      path.join(root, "Cargo.toml"),
      '[package]\nname="actual"\nversion="1.0.0"\n',
    );
    await fsp.writeFile(path.join(root, "src/lib.rs"), "pub fn value() {}\n");
    await run("git", ["init", "-q"], root);
    await run("git", ["config", "user.email", "fixture@example.invalid"], root);
    await run("git", ["config", "user.name", "Fixture"], root);
    await run("git", ["add", "."], root);
    await run("git", ["commit", "-qm", "fixture"], root);
    const revision = await run("git", ["rev-parse", "HEAD"], root);
    const source = `git+https://example.invalid/repository#${revision}`;
    const materialize = async () => ({ storePath: "/nix/store/unreachable", narHash: "sha256-x" });
    await assert.rejects(
      materializeFixedSources(
        {
          [`actual@1.0.0#git+https://example.invalid/repository#${"0".repeat(40)}`]: {
            originPath: root,
            source: `git+https://example.invalid/repository#${"0".repeat(40)}`,
            checksum: "",
          },
        },
        materialize,
        run,
      ),
      /revision does not match Cargo.lock/,
    );
    await assert.rejects(
      materializeFixedSources(
        { [`wrong@1.0.0#${source}`]: { originPath: root, source, checksum: "" } },
        materialize,
        run,
      ),
      /does not match locked name\/version/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
