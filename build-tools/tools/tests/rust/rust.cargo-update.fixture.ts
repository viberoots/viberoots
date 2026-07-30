import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function rustUpdateFixture(): Promise<{ root: string; cargo: string; log: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-update-"));
  const cargo = path.join(root, "fake-cargo");
  const log = path.join(root, "cargo-argv.jsonl");
  await fsp.writeFile(
    cargo,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const { spawnSync } = require("node:child_process");',
      "const args = process.argv.slice(2);",
      "const root = path.basename(process.cwd());",
      'fs.appendFileSync(process.env.FAKE_CARGO_LOG, JSON.stringify({args, root, cargoHome: process.env.CARGO_HOME, offline: process.env.CARGO_NET_OFFLINE, path: process.env.PATH, token: process.env.CARGO_REGISTRIES_CRATES_IO_TOKEN}) + "\\n");',
      'if (process.env.FAKE_CARGO_PROBE_TOOLS) { spawnSync("rustc", [], { env: process.env }); spawnSync("rustdoc", [], { env: process.env }); }',
      "const sleep = Number(process.env.FAKE_CARGO_SLEEP_MS || 0);",
      "if (sleep) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep);",
      'if (process.env.FAKE_CARGO_FAIL_ROOT === root) { process.stderr.write(process.env.FAKE_CARGO_STDERR || "fixture failure"); process.exit(23); }',
      'const lock = path.join(process.cwd(), "Cargo.lock");',
      'if (args[0] === "update") fs.writeFileSync(lock, "upgrade\\n");',
      'if (args[0] === "metadata" && !args.includes("--locked") && !process.env.FAKE_CARGO_PRESERVE_LOCK) fs.writeFileSync(lock, "reconciled\\n");',
      'if (args.includes("--locked") && (!fs.existsSync(lock) || fs.readFileSync(lock, "utf8").includes("stale"))) process.exit(24);',
      'process.stdout.write((process.env.FAKE_CARGO_METADATA_JSON || "{}") + "\\n");',
    ].join("\n"),
    { mode: 0o755 },
  );
  for (const tool of ["rustc", "rustdoc"]) {
    await fsp.writeFile(
      path.join(root, tool),
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs");',
        'fs.appendFileSync(process.env.FAKE_CARGO_TOOL_LOG, process.argv[1] + "\\n");',
      ].join("\n"),
      { mode: 0o755 },
    );
  }
  return { root, cargo, log };
}

export async function addCargoRoot(root: string, name: string, lock?: string): Promise<string> {
  const cargoRoot = path.join(root, "projects", "apps", name);
  await fsp.mkdir(path.join(cargoRoot, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(cargoRoot, "Cargo.toml"),
    `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\n`,
  );
  await fsp.writeFile(path.join(cargoRoot, "src", "lib.rs"), "pub fn value() -> u8 { 1 }\n");
  if (lock !== undefined) await fsp.writeFile(path.join(cargoRoot, "Cargo.lock"), lock);
  return cargoRoot;
}

export function withCargoEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const prior = { ...process.env };
  Object.assign(process.env, env);
  return run().finally(() => {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
  });
}
