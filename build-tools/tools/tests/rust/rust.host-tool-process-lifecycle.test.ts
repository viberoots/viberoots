#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { runManagedCommand, type ManagedCommandActivity } from "../../lib/managed-command";

async function waitForFile(file: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await fsp.access(file).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for host-tool descendant: ${file}`);
}

async function waitForPidGone(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`host-tool descendant ${pid} survived cleanup`);
}

function activity(): ManagedCommandActivity {
  return {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
  };
}

async function writeCargoFixture(root: string, sleep: string): Promise<void> {
  await fsp.writeFile(
    path.join(root, "Cargo.toml"),
    '[workspace]\nresolver="2"\nmembers=["build-host","host-macro","macro-consumer"]\n',
  );
  for (const member of ["build-host", "host-macro", "macro-consumer"]) {
    await fsp.mkdir(path.join(root, member, "src"), { recursive: true });
  }
  await fsp.writeFile(
    path.join(root, "build-host/Cargo.toml"),
    '[package]\nname="build-host"\nversion="0.1.0"\nedition="2021"\nbuild="build.rs"\n',
  );
  await fsp.writeFile(path.join(root, "build-host/src/lib.rs"), "pub fn value() -> u8 { 1 }\n");
  await fsp.writeFile(
    path.join(root, "build-host/build.rs"),
    [
      "use std::{env, fs, process::Command};",
      'fn main() { println!("cargo:rerun-if-env-changed=HOST_MODE");',
      'if env::var("HOST_MODE").as_deref() == Ok("block") {',
      `let mut child=Command::new(${JSON.stringify(sleep)}).arg("30").spawn().unwrap();`,
      'fs::write(env::var("HOST_PID_FILE").unwrap(), child.id().to_string()).unwrap();',
      "child.wait().unwrap(); }}",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(root, "host-macro/Cargo.toml"),
    '[package]\nname="host-macro"\nversion="0.1.0"\nedition="2021"\n[lib]\nproc-macro=true\n',
  );
  await fsp.writeFile(
    path.join(root, "host-macro/src/lib.rs"),
    [
      "use proc_macro::TokenStream; use std::{env, fs, process::Command};",
      "#[proc_macro] pub fn host_probe(_: TokenStream) -> TokenStream {",
      'if env::var("HOST_MODE").as_deref() == Ok("block") {',
      `let mut child=Command::new(${JSON.stringify(sleep)}).arg("30").spawn().unwrap();`,
      'fs::write(env::var("HOST_PID_FILE").unwrap(), child.id().to_string()).unwrap();',
      "child.wait().unwrap(); }",
      '"pub fn generated() -> u8 { 7 }".parse().unwrap() }',
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(root, "macro-consumer/Cargo.toml"),
    '[package]\nname="macro-consumer"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nhost-macro={path="../host-macro"}\n',
  );
  await fsp.writeFile(
    path.join(root, "macro-consumer/src/lib.rs"),
    "use host_macro::host_probe;\nhost_probe!();\npub fn value() -> u8 { generated() }\n",
  );
}

test("real Cargo build.rs and proc-macro cleanup descendants and allow retry", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rust-host-tool-lifecycle-"));
  try {
    const viberootsRoot = await fsp.realpath(
      path.join(String(process.env.VBR_ARTIFACT_TOOLS_ROOT), "share", "viberoots-source"),
    );
    const expression = `let f = builtins.getFlake ${JSON.stringify(
      `path:${viberootsRoot}`,
    )}; pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem}; in pkgs.symlinkJoin { name = "rust-host-tool-test-toolchain"; paths = [ pkgs.cargo pkgs.rustc pkgs.stdenv.cc pkgs.coreutils ]; }`;
    const toolchain = await runManagedCommand({
      command: process.env.NIX_BIN || "/nix/var/nix/profiles/default/bin/nix",
      args: ["build", "--impure", "--no-link", "--print-out-paths", "--expr", expression],
      timeoutMs: 120_000,
    });
    assert.equal(toolchain.ok, true, toolchain.stderr);
    const toolchainRoot = toolchain.stdout.trim().split("\n").at(-1);
    assert.ok(toolchainRoot, "Nix did not return the Rust host-tool test toolchain");
    const cargo = path.join(toolchainRoot, "bin", "cargo");
    const pinnedSleep = path.join(toolchainRoot, "bin", "sleep");
    await writeCargoFixture(tmp, pinnedSleep);
    const hostileBin = path.join(tmp, "hostile-bin");
    await fsp.mkdir(hostileBin);
    await fsp.writeFile(
      path.join(hostileBin, "sleep"),
      "#!/bin/sh\necho ambient-sleep-was-used >&2\nexit 97\n",
    );
    await fsp.chmod(path.join(hostileBin, "sleep"), 0o755);
    const toolEnv = {
      ...process.env,
      PATH: `${hostileBin}${path.delimiter}${path.join(toolchainRoot, "bin")}`,
      RUSTC: path.join(toolchainRoot, "bin", "rustc"),
    };
    const timeoutPid = path.join(tmp, "timeout.pid");
    const timed = await runManagedCommand({
      command: cargo,
      args: ["build", "--offline", "-p", "build-host"],
      cwd: tmp,
      env: { ...toolEnv, HOST_MODE: "block", HOST_PID_FILE: timeoutPid },
      timeoutMs: 2_000,
      killGraceMs: 50,
      activity: activity(),
    });
    assert.equal(timed.timedOut, true);
    await waitForPidGone(Number(await fsp.readFile(timeoutPid, "utf8")));

    const interruptPid = path.join(tmp, "interrupt.pid");
    const interruptedActivity = activity();
    const pending = runManagedCommand({
      command: cargo,
      args: ["build", "--offline", "-p", "macro-consumer"],
      cwd: tmp,
      env: { ...toolEnv, HOST_MODE: "block", HOST_PID_FILE: interruptPid },
      timeoutMs: 30_000,
      killGraceMs: 50,
      activity: interruptedActivity,
    });
    await waitForFile(interruptPid);
    process.emit("SIGINT");
    const interrupted = await pending;
    assert.equal(interrupted.interrupted, true);
    assert.equal(interruptedActivity.childPid !== undefined, true);
    await waitForPidGone(Number(await fsp.readFile(interruptPid, "utf8")));

    const retry = await runManagedCommand({
      command: cargo,
      args: ["build", "--offline", "--workspace"],
      cwd: tmp,
      env: { ...toolEnv, HOST_MODE: "success", HOST_PID_FILE: path.join(tmp, "retry.pid") },
      timeoutMs: 30_000,
    });
    assert.equal(retry.ok, true);
    assert.match(retry.stderr, /Finished/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
