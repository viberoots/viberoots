import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { buildSelectedOutPath } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { timeDiagnosticAsync } from "../lib/test-helpers/timing";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";
import { activateTauriSubmodule } from "./rust.tauri-scaffold-lifecycle-activation";

type SourceMode = "flake" | "submodule";

const patchDep = "itoa";
const patchVersion = "1.0.15";
const patchSource = "registry+https://github.com/rust-lang/crates.io-index";
const patchChecksum = "4a5f13b858c8d314ee3e8f639011f7ccefe71f97f96e50151fb991f267928e2c";
const patchKey = `${patchDep}@${patchVersion}#${patchSource}`;

async function readGitDiff(consumer: string, env: NodeJS.ProcessEnv, $: typeof globalThis.$) {
  const diff = await $({ cwd: consumer, env, stdio: "pipe" })`git diff --binary HEAD`;
  return String(diff.stdout);
}

async function addPatchDependency(appDir: string): Promise<void> {
  await fsp.writeFile(
    path.join(appDir, "Cargo.toml"),
    `${await fsp.readFile(path.join(appDir, "Cargo.toml"), "utf8")}itoa = "${patchVersion}"\n`,
  );
  await fsp.writeFile(
    path.join(appDir, "Cargo.lock"),
    `${(await fsp.readFile(path.join(appDir, "Cargo.lock"), "utf8")).replace(
      'dependencies = ["pyo3"]',
      `dependencies = ["${patchDep}", "pyo3"]`,
    )}\n[[package]]\nname = "${patchDep}"\nversion = "${patchVersion}"\nsource = "${patchSource}"\nchecksum = "${patchChecksum}"\n`,
  );
  await fsp.writeFile(
    path.join(appDir, "src", "lib.rs"),
    (await fsp.readFile(path.join(appDir, "src", "lib.rs"), "utf8")).replace(
      "Ok(42)",
      "{ let mut b = itoa::Buffer::new(); Ok(b.format(42).parse().unwrap()) }",
    ),
  );
}

async function vendorAuthority(
  consumer: string,
  workspaceFlake: string,
  appDir: string,
  $: typeof globalThis.$,
) {
  const expr = `let f = builtins.getFlake ${JSON.stringify(`path:${workspaceFlake}`)};
nixpkgs = if f.inputs ? nixpkgs then f.inputs.nixpkgs else f.inputs.viberoots.inputs.nixpkgs;
pkgs = nixpkgs.legacyPackages.\${builtins.currentSystem};
in pkgs.rustPlatform.importCargoLock { lockFile = ${JSON.stringify(path.join(appDir, "Cargo.lock"))}; }`;
  const imported = await $({
    cwd: consumer,
    stdio: "pipe",
  })`nix build --impure --no-link --print-out-paths --expr ${expr}`;
  const vendorRoot = String(imported.stdout).trim();
  const entry = (await fsp.readdir(vendorRoot)).find((name) => name.startsWith(`${patchDep}-`));
  assert.ok(entry);
  const storePath = path.join(vendorRoot, entry);
  const hash = await $({ stdio: "pipe" })`nix hash path --type sha256 --sri ${storePath}`;
  return {
    source: patchSource,
    checksum: patchChecksum,
    storePath,
    narHash: String(hash.stdout).trim(),
  };
}

async function buildSelected(
  consumer: string,
  target: string,
  env: NodeJS.ProcessEnv,
  $: typeof globalThis.$,
): Promise<string> {
  return await buildSelectedOutPath({ tmp: consumer, $, target, env });
}

async function assertPyodideRun(
  consumer: string,
  outPath: string,
  env: NodeJS.ProcessEnv,
  $: typeof globalThis.$,
  expected: number,
): Promise<number> {
  const run = await $({
    cwd: consumer,
    env,
    stdio: "pipe",
  })`node ${path.join(outPath, "bin", "run.mjs")}`;
  const match = String(run.stdout).match(/RUST_PYODIDE_VALUE=(\d+)/);
  assert.ok(match, `${String(run.stdout)}\n${String(run.stderr)}`);
  const actual = Number(match[1]);
  assert.equal(actual, expected);
  return actual;
}

export async function runRustPyodideScaffoldLifecycle(
  tmp: string,
  mode: SourceMode,
  $: typeof globalThis.$,
): Promise<void> {
  const phase = async <T>(name: string, fn: () => Promise<T>) =>
    await timeDiagnosticAsync(`rust pyodide scaffold ${mode} ${name}`, fn);
  const source = await phase(
    "remote source preparation",
    async () => await makeRemoteSource(tmp, $),
  );
  const consumer = await phase(
    "consumer preparation",
    async () => await makeConsumer(tmp, `rust-pyodide-${mode}`, source, $),
  );
  const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
  try {
    if (mode === "submodule") {
      await phase(
        "submodule activation",
        async () => await activateTauriSubmodule(consumer, source, workspaceFlake, $),
      );
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await phase(`workspace initialization ${attempt + 1}`, async () => {
        await $({
          cwd: consumer,
          env: { ...process.env, WORKSPACE_ROOT: consumer },
          stdio: "pipe",
        })`nix run --option eval-cache false --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
      });
    }
    if (mode === "submodule") {
      const filteredInput = path.join(workspaceFlake, "viberoots-flake-input");
      await fsp.access(path.join(filteredInput, ".source-fingerprint"));
      const sourcePrelude = await fsp.realpath(path.join(consumer, "viberoots", "prelude"));
      await fsp.rm(path.join(workspaceFlake, "prelude"), { recursive: true, force: true });
      await fsp.symlink(sourcePrelude, path.join(workspaceFlake, "prelude"));
      await fsp.access(path.join(workspaceFlake, "prelude", "prelude.bzl"));
      await fsp.rm(path.join(consumer, ".envrc"), { force: true });
    }
    const sourcePath = await fsp.realpath(path.join(consumer, ".viberoots", "current"));
    assert.equal(
      mode === "submodule"
        ? sourcePath === path.join(consumer, "viberoots")
        : sourcePath !== source,
      true,
    );
    const lifecycleEnv = (extra: NodeJS.ProcessEnv = {}) => commandEnv(consumer, extra);
    await phase("dry run", async () => {
      const dryRun = await $({
        cwd: consumer,
        env: lifecycleEnv(),
        stdio: "pipe",
      })`scaf new rust pyodide-extension rust_pyodide_demo --dry-run --yes`;
      assert.match(`${String(dryRun.stdout)}\n${String(dryRun.stderr)}`, /rust_pyodide_demo/);
    });
    await phase("materialization", async () => {
      await $({
        cwd: consumer,
        env: lifecycleEnv(),
      })`scaf new rust pyodide-extension rust_pyodide_demo --yes`;
    });
    const appDir = path.join(consumer, "projects", "apps", "rust_pyodide_demo");
    await addPatchDependency(appDir);
    await $({ cwd: consumer, env: lifecycleEnv() })`git config user.email test@example.com`;
    await $({ cwd: consumer, env: lifecycleEnv() })`git config user.name test`;
    await $({ cwd: consumer, env: lifecycleEnv() })`git add projects`;
    if (mode === "submodule") {
      await $({ cwd: consumer, env: lifecycleEnv() })`git add .gitmodules viberoots`;
    }
    await $({ cwd: consumer, env: lifecycleEnv() })`git commit -m rust-pyodide-scaffold`;
    const updateEnv = lifecycleEnv(
      mode === "flake" ? { VIBEROOTS_FLAKE_INPUT_ROOT: sourcePath } : {},
    );
    await phase("workspace update", async () => await $({ cwd: consumer, env: updateEnv })`u`);
    const beforeInstall = await readGitDiff(consumer, lifecycleEnv(), $);
    await phase(
      "read-only install",
      async () => await $({ cwd: consumer, env: updateEnv })`i --without-secrets`,
    );
    assert.equal(
      await readGitDiff(consumer, lifecycleEnv(), $),
      beforeInstall,
      "i changed tracked bytes",
    );
    const target = "//projects/apps/rust_pyodide_demo:rust_pyodide_demo";
    let selectedOutPath = "";
    await phase("selected build", async () => {
      selectedOutPath = await buildSelected(consumer, target, lifecycleEnv(), $);
    });
    await phase("Pyodide execution", async () => {
      await assertPyodideRun(consumer, selectedOutPath, lifecycleEnv(), $, 42);
    });
    const baselineOutPath = selectedOutPath;
    const cli = path.join(
      consumer,
      ".viberoots",
      "current",
      "build-tools",
      "tools",
      "bin",
      "patch-pkg",
    );
    await phase("patch apply/remove", async () => {
      const authority = await vendorAuthority(consumer, workspaceFlake, appDir, $);
      const patchEnv = lifecycleEnv({
        NIX_RUST_DEV_OVERRIDE_JSON: "{}",
        NIX_RUST_TEST_RESOLVE_JSON: JSON.stringify({
          [patchKey]: { ...authority, buildInput: authority },
        }),
      });
      await $({
        cwd: consumer,
        env: patchEnv,
      })`${cli} start rust ${patchDep} --target //projects/apps/rust_pyodide_demo:rust_pyodide_demo-ext`;
      const sessions = JSON.parse(
        await fsp.readFile(path.join(consumer, ".patch-sessions.json"), "utf8"),
      );
      const session = sessions.sessions.rust[patchKey] as { workspacePath: string };
      await fsp.writeFile(
        path.join(session.workspacePath, "src", "lib.rs"),
        'pub struct Buffer { text: String }\nimpl Buffer { pub fn new() -> Self { Self { text: String::new() } } pub fn format<I>(&mut self, _: I) -> &str { self.text = "43".into(); &self.text } }\n',
      );
      await $({
        cwd: consumer,
        env: patchEnv,
      })`${cli} apply rust ${patchDep} --target //projects/apps/rust_pyodide_demo:rust_pyodide_demo-ext`;
      const patchedOutPath = await buildSelected(consumer, target, lifecycleEnv(), $);
      assert.notEqual(patchedOutPath, baselineOutPath);
      await assertPyodideRun(consumer, patchedOutPath, lifecycleEnv(), $, 43);
      await $({
        cwd: consumer,
        env: patchEnv,
      })`${cli} remove rust ${patchDep} --target //projects/apps/rust_pyodide_demo:rust_pyodide_demo-ext`;
      const restoredOutPath = await buildSelected(consumer, target, lifecycleEnv(), $);
      assert.equal(restoredOutPath, baselineOutPath);
      await assertPyodideRun(consumer, restoredOutPath, lifecycleEnv(), $, 42);
    });
  } finally {
    await killBuckDaemonsForRepo(tmp, $);
  }
}
