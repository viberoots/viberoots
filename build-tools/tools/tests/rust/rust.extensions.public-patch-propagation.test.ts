#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildSelectedOutPath, exportGraphInTemp, runInTemp } from "../lib/test-helpers";
import { writeCombinedRustExtensionPackage } from "./rust-extension-runtime-fixture";

const dependency = "itoa";
const version = "1.0.15";
const source = "registry+https://github.com/rust-lang/crates.io-index";
const checksum = "4a5f13b858c8d314ee3e8f639011f7ccefe71f97f96e50151fb991f267928e2c";
const key = `${dependency}@${version}#${source}`;

async function answer(tmp: string, pyOut: string, nodeOut: string): Promise<number[]> {
  const python = path.join(String(process.env.VBR_ARTIFACT_TOOLS_ROOT), "bin/python3");
  const py = await $({
    cwd: tmp,
    env: { ...process.env, PYTHONPATH: path.join(pyOut, "site"), PYTHONNOUSERSITE: "1" },
    stdio: "pipe",
  })`${python} -c "import demo._native as native; print(native.answer())"`;
  const node = await $({ cwd: tmp, stdio: "pipe" })`${process.execPath} -e ${[
    "const addon = require(process.argv[1])",
    "console.log(addon.answer())",
  ].join("; ")} ${path.join(nodeOut, "lib/rust_native.node")}`;
  return [Number(String(py.stdout).trim()), Number(String(node.stdout).trim())];
}

test("one public Rust dependency patch changes and restores Python and Node extensions", async () => {
  await runInTemp("rust-extension-public-patch", async (tmp, $) => {
    await writeCombinedRustExtensionPackage(tmp);
    const extensionRoot = path.join(tmp, "projects/libs/rust_extensions");
    const manifest = await fs.readFile(path.join(extensionRoot, "Cargo.toml"), "utf8");
    await fs.writeFile(
      path.join(extensionRoot, "Cargo.toml"),
      `${manifest}\n[dependencies]\n${dependency}="${version}"\n`,
    );
    await fs.writeFile(
      path.join(extensionRoot, "Cargo.lock"),
      [
        "version = 3",
        "",
        "[[package]]",
        'name = "rust_extensions"',
        'version = "0.1.0"',
        "dependencies = [",
        ` "${dependency}",`,
        "]",
        "",
        "[[package]]",
        `name = "${dependency}"`,
        `version = "${version}"`,
        `source = "${source}"`,
        `checksum = "${checksum}"`,
        "",
      ].join("\n"),
    );
    const rust = await fs.readFile(path.join(extensionRoot, "src/lib.rs"), "utf8");
    const patchedValue =
      "{ let mut buffer = itoa::Buffer::new(); buffer.format(c_answer()).parse::<i32>().unwrap() }";
    await fs.writeFile(
      path.join(extensionRoot, "src/lib.rs"),
      rust
        .replace("PyLong_FromLong(c_answer() as i64)", `PyLong_FromLong((${patchedValue}) as i64)`)
        .replace("napi_create_int32(env, c_answer(),", `napi_create_int32(env, ${patchedValue},`),
    );
    const sessionFile = path.join(tmp, ".patch-sessions.json");
    const baselineSession = '{\n  "version": 1,\n  "sessions": {\n    "rust": {}\n  }\n}\n';
    await fs.writeFile(sessionFile, baselineSession);
    await exportGraphInTemp({ tmp, $ });
    const targets = [
      "//projects/libs/rust_extensions:extension",
      "//projects/libs/rust_extensions:addon",
    ];
    const build = async () => {
      const outputs: string[] = [];
      for (const target of targets) {
        outputs.push(await buildSelectedOutPath({ tmp, $, target }));
      }
      return outputs;
    };
    const baseline = await build();
    assert.deepEqual(await answer(tmp, baseline[0], baseline[1]), [42, 42]);

    const workspaceFlake = `path:${path.join(tmp, ".viberoots/workspace")}`;
    const importExpression = `let f = builtins.getFlake ${JSON.stringify(
      workspaceFlake,
    )}; pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem}; in pkgs.rustPlatform.importCargoLock { lockFile = ${JSON.stringify(
      path.join(extensionRoot, "Cargo.lock"),
    )}; }`;
    const imported = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build --impure --out-link ${path.join(tmp, "itoa-vendor-root")} --print-out-paths --expr ${importExpression}`;
    const vendorRoot = String(imported.stdout).trim();
    const dependencyDir = (await fs.readdir(vendorRoot)).find((entry) =>
      entry.startsWith(`${dependency}-`),
    );
    assert.ok(dependencyDir, `missing ${dependency} in ${vendorRoot}`);
    const storePath = path.join(vendorRoot, dependencyDir);
    const hashed = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix hash path --type sha256 --sri ${storePath}`;
    const fixedAuthority = {
      source,
      checksum,
      storePath,
      narHash: String(hashed.stdout).trim(),
    };
    const env = {
      ...process.env,
      WORKSPACE_ROOT: tmp,
      NIX_RUST_DEV_OVERRIDE_JSON: "{}",
      NIX_RUST_TEST_RESOLVE_JSON: JSON.stringify({
        [key]: {
          originPath: storePath,
          ...fixedAuthority,
          buildInput: fixedAuthority,
        },
      }),
    };
    const cli = "viberoots/build-tools/tools/bin/patch-pkg";
    await $({ cwd: tmp, env })`${cli} start rust ${dependency} --target ${targets[0]}`;
    const sessions = JSON.parse(await fs.readFile(path.join(tmp, ".patch-sessions.json"), "utf8"));
    const patchWorkspace = sessions.sessions.rust[key].workspacePath as string;
    await fs.writeFile(
      path.join(patchWorkspace, "src/lib.rs"),
      'pub struct Buffer { text: String }\nimpl Buffer { pub fn new() -> Self { Self { text: String::new() } } pub fn format<I>(&mut self, _: I) -> &str { self.text = "43".into(); &self.text } }\n',
    );
    await $({ cwd: tmp, env })`${cli} apply rust ${dependency} --target ${targets[0]}`;
    const patchFile = (await fs.readdir(path.join(extensionRoot, "patches/rust")))[0];
    assert.ok(patchFile);
    await exportGraphInTemp({ tmp, $ });
    const applied = await build();
    assert.deepEqual(await answer(tmp, applied[0], applied[1]), [43, 43]);
    assert.notDeepEqual(applied, baseline);

    await $({ cwd: tmp, env })`${cli} start rust ${dependency} --target ${targets[0]}`;
    await $({ cwd: tmp, env })`${cli} remove rust ${dependency} --target ${targets[0]}`;
    await exportGraphInTemp({ tmp, $ });
    const removed = await build();
    assert.deepEqual(await answer(tmp, removed[0], removed[1]), [42, 42]);
    assert.deepEqual(removed, baseline);
    assert.equal(await fs.readFile(sessionFile, "utf8"), baselineSession);
    await assert.rejects(fs.access(path.join(extensionRoot, "patches")));
  });
});
