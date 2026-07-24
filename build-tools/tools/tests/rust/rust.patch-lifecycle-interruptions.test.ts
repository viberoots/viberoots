#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { rustPatchFilename } from "../../patch/rust-sync-required";
import { runInTemp } from "../lib/test-helpers";

type SessionChild = {
  child: ChildProcess;
  completion: Promise<{ code: number | null; signal: string | null }>;
  output: () => string;
  workspace: Promise<string>;
};

function waitForSession(child: ChildProcess, output: () => string): Promise<string> {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      const text = output();
      const workspace = text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => path.isAbsolute(line) && line.includes("viberoots-patch-rust"));
      if (workspace && text.includes("Attached. Ctrl-D to apply, Ctrl-C to reset.")) {
        resolve(workspace);
      }
    };
    child.stdout?.on("data", inspect);
    child.stderr?.on("data", inspect);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Rust session exited before attachment: code=${String(code)} signal=${String(signal)}\n${output()}`,
        ),
      );
    });
  });
}

function startSession(tmp: string, env: NodeJS.ProcessEnv, cargoRelative: string): SessionChild {
  const zxInit = path.join(tmp, "viberoots/build-tools/tools/dev/zx-init.mjs");
  const entrypoint = path.join(tmp, "viberoots/build-tools/tools/patch/patch-pkg.ts");
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      zxInit,
      entrypoint,
      "session",
      "rust",
      "dep",
      "--importer",
      cargoRelative,
    ],
    { cwd: tmp, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] },
  );
  let text = "";
  child.stdout?.on("data", (chunk) => (text += String(chunk)));
  child.stderr?.on("data", (chunk) => (text += String(chunk)));
  const output = () => text;
  const completion = new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  return { child, completion, output, workspace: waitForSession(child, output) };
}

async function rustSessions(tmp: string): Promise<Record<string, unknown>> {
  const store = JSON.parse(await fsp.readFile(path.join(tmp, ".patch-sessions.json"), "utf8"));
  return store.sessions?.rust || {};
}

test("Rust patch-pkg session cleans up on terminal controls, signals, and hard owner death", async () => {
  await runInTemp("rust-patch-lifecycle", async (tmp, $) => {
    const cargoRelative = "projects/libs/demo";
    const cargoRoot = path.join(tmp, cargoRelative);
    const origin = path.join(tmp, "fixed-source");
    const source = "registry+https://registry.example/index";
    const key = `dep@1.0.0#${source}`;
    await Promise.all(
      [cargoRoot, origin].map((directory) => fsp.mkdir(directory, { recursive: true })),
    );
    await fsp.writeFile(path.join(tmp, "flake.nix"), "{}\n");
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.toml"),
      '[package]\nname="demo"\nversion="0.1.0"\n[dependencies]\ndep="1"\n',
    );
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.lock"),
      `version=3\n[[package]]\nname="dep"\nversion="1.0.0"\nsource="${source}"\nchecksum="fixture"\n`,
    );
    await fsp.writeFile(path.join(origin, "lib.rs"), "pub fn value() -> u8 { 1 }\n");
    await fsp.writeFile(
      path.join(origin, ".cargo-checksum.json"),
      JSON.stringify({ package: "fixture", files: {} }),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      WORKSPACE_ROOT: tmp,
      NIX_RUST_DEV_OVERRIDE_JSON: "{}",
      NIX_RUST_TEST_RESOLVE_JSON: JSON.stringify({
        [key]: {
          originPath: origin,
          source,
          checksum: "fixture",
          storePath: origin,
          narHash: "sha256-fixture",
          buildInput: {
            source,
            checksum: "fixture",
            storePath: origin,
            narHash: "sha256-fixture",
          },
        },
      }),
    };

    const apply = startSession(tmp, env, cargoRelative);
    const applyWorkspace = await apply.workspace;
    await fsp.writeFile(path.join(applyWorkspace, "lib.rs"), "pub fn value() -> u8 { 2 }\n");
    apply.child.stdin?.write("\u0004");
    assert.deepEqual(await apply.completion, { code: 0, signal: null }, apply.output());
    assert.deepEqual(await rustSessions(tmp), {});
    await fsp.access(applyWorkspace);
    await fsp.access(
      path.join(cargoRoot, "patches/rust", rustPatchFilename("dep", "1.0.0", source)),
    );

    const reset = startSession(tmp, env, cargoRelative);
    const resetWorkspace = await reset.workspace;
    reset.child.stdin?.write("\u0003");
    assert.deepEqual(await reset.completion, { code: 0, signal: null }, reset.output());
    assert.deepEqual(await rustSessions(tmp), {});
    await assert.rejects(fsp.access(resetWorkspace));

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const interrupted = startSession(tmp, env, cargoRelative);
      const interruptedWorkspace = await interrupted.workspace;
      interrupted.child.kill(signal);
      assert.deepEqual(
        await interrupted.completion,
        { code: 1, signal: null },
        interrupted.output(),
      );
      assert.deepEqual(await rustSessions(tmp), {});
      await fsp.access(interruptedWorkspace);
    }

    const killed = startSession(tmp, env, cargoRelative);
    const abandonedWorkspace = await killed.workspace;
    killed.child.kill("SIGKILL");
    const killedOutcome = await killed.completion;
    assert.equal(killedOutcome.signal, "SIGKILL", killed.output());
    assert.ok((await rustSessions(tmp))[key]);

    const cli = "viberoots/build-tools/tools/bin/patch-pkg";
    await $`chmod +x ${cli}`;
    await $({ cwd: tmp, env })`${cli} start rust dep --importer ${cargoRelative}`;
    const replacement = (await rustSessions(tmp))[key] as { workspacePath: string };
    assert.notEqual(replacement.workspacePath, abandonedWorkspace);
    await fsp.access(abandonedWorkspace);
  });
});
