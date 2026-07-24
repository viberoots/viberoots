import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);
const gitIdentity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];
const staleError =
  /tracked metadata is stale: projects\/apps\/stale-rust\/Cargo\.lock[\s\S]*repair: run u/;

export async function git(root: string, args: string[]): Promise<string> {
  return String((await execFileAsync("git", args, { cwd: root })).stdout || "");
}

export async function commitAll(root: string, message: string): Promise<void> {
  await git(root, ["add", "-A"]);
  await git(root, [...gitIdentity, "commit", "-qm", message]);
}

export async function trackedState(root: string): Promise<string> {
  return await git(root, ["status", "--short"]);
}

export async function expectStale(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const result: any = await run();
    assert.fail(
      [
        `${label} unexpectedly accepted stale Cargo metadata`,
        String(result?.stderr || ""),
        String(result?.stdout || ""),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (error: any) {
    if (error?.code === "ERR_ASSERTION") throw error;
    assert.match(
      `${String(error?.stderr || "")}\n${String(error?.stdout || "")}\n${String(error)}`,
      staleError,
    );
  }
}

export async function addStaleRustRoot(
  root: string,
  env: NodeJS.ProcessEnv,
  cargoBin?: string,
  prepareCurrent?: () => Promise<void>,
): Promise<string> {
  const cargoRoot = path.join(root, "projects/apps/stale-rust");
  await fsp.mkdir(path.join(cargoRoot, "src"), { recursive: true });
  const manifest = path.join(cargoRoot, "Cargo.toml");
  await fsp.writeFile(
    manifest,
    '[package]\nname = "stale-rust"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  await fsp.writeFile(
    path.join(cargoRoot, "TARGETS"),
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")',
      "",
      'rust_library(name = "lib", crate = "stale_rust", srcs = ["src/lib.rs"])',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(path.join(cargoRoot, "src/lib.rs"), "pub fn value() -> u8 { 1 }\n");
  const cargo =
    cargoBin ||
    ensureNixStoreToolPathSync("cargo", {
      PATH: path.join(canonicalArtifactToolsRoot(root), "bin"),
    });
  await execFileAsync(cargo, ["generate-lockfile", "--offline"], {
    cwd: cargoRoot,
    env: {
      ...env,
      CARGO_HOME: path.join(root, ".viberoots/workspace/cargo-home"),
      CARGO_NET_OFFLINE: "true",
    },
  });
  await commitAll(root, "test: add current Rust metadata");
  if (prepareCurrent) {
    await prepareCurrent();
    const nestedRoot = path.join(root, "viberoots");
    const repairedNestedState = await git(nestedRoot, [
      "status",
      "--short",
      "--untracked-files=no",
    ]);
    if (repairedNestedState) {
      await git(nestedRoot, ["add", "-u"]);
      await git(nestedRoot, [...gitIdentity, "commit", "-qm", "test: record repaired baseline"]);
    }
  }
  await fsp.writeFile(
    manifest,
    '[package]\nname = "stale-rust"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nserde = "=1.0.0"\n',
  );
  await commitAll(root, "test: make Rust metadata stale");
  await assert.rejects(
    execFileAsync(cargo, ["metadata", "--locked", "--offline", "--format-version", "1"], {
      cwd: cargoRoot,
      env: {
        ...env,
        CARGO_HOME: path.join(root, ".viberoots/workspace/cargo-home"),
        CARGO_NET_OFFLINE: "true",
      },
    }),
    /lock file .*needs to be updated|no matching package named `serde` found/s,
  );
  return path.join(cargoRoot, "Cargo.lock");
}
