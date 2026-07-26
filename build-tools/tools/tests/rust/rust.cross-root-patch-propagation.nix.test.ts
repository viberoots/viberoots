#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exportGraphInTemp, runBuildSelected, runInTemp } from "../lib/test-helpers";

const source = "registry+https://github.com/rust-lang/crates.io-index";
const dependency = "itoa";
const version = "1.0.15";
const checksum = "4a5f13b858c8d314ee3e8f639011f7ccefe71f97f96e50151fb991f267928e2c";
const key = `${dependency}@${version}#${source}`;

async function writePackage(
  root: string,
  name: string,
  manifestTail: string,
  sourceFile: string,
): Promise<void> {
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(root, "Cargo.toml"),
    `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\n${manifestTail}`,
  );
  await fsp.writeFile(path.join(root, "src", name === "app" ? "main.rs" : "lib.rs"), sourceFile);
}

function lock(packages: string[]): string {
  const dependencyFor: Record<string, string> = {
    app: "mid",
    mid: "core",
    core: dependency,
  };
  return [
    "version = 3",
    ...packages.flatMap((name) => [
      "",
      "[[package]]",
      `name = "${name}"`,
      `version = "${name === dependency ? version : "0.1.0"}"`,
      ...(name === dependency ? [`source = "${source}"`, `checksum = "${checksum}"`] : []),
      ...(dependencyFor[name] ? ["dependencies = [", ` "${dependencyFor[name]}",`, "]"] : []),
    ]),
    "",
  ].join("\n");
}

test("public patch-pkg propagates, reverses, and selectively invalidates Rust roots", async () => {
  await runInTemp("rust-public-cross-root-patch", async (tmp, $) => {
    const roots = Object.fromEntries(
      ["core", "mid", "app", "unrelated"].map((name) => [
        name,
        path.join(tmp, "projects", name === "app" ? "apps" : "libs", `patch_${name}`),
      ]),
    );
    await writePackage(
      roots.core,
      "core",
      `[dependencies]\n${dependency}="${version}"\n[[bin]]\nname="sibling"\npath="src/sibling.rs"\n`,
      "pub fn value() -> String { let mut buffer = itoa::Buffer::new(); buffer.format(1).to_owned() }\n",
    );
    await fsp.writeFile(
      path.join(roots.core, "src/sibling.rs"),
      'fn main() { println!("same-root"); }\n',
    );
    await writePackage(
      roots.mid,
      "mid",
      '[dependencies]\ncore={path="../patch_core",version="0.1"}\n',
      "pub fn value() -> String { core::value() }\n",
    );
    await writePackage(
      roots.app,
      "app",
      '[dependencies]\nmid={path="../../libs/patch_mid",version="0.1"}\n',
      'fn main() { println!("{}", mid::value()); }\n',
    );
    await writePackage(roots.unrelated, "unrelated", "", "pub fn value() -> u8 { 9 }\n");
    await fsp.writeFile(path.join(roots.core, "Cargo.lock"), lock(["core", dependency]));
    await fsp.writeFile(path.join(roots.mid, "Cargo.lock"), lock(["mid", "core", dependency]));
    await fsp.writeFile(
      path.join(roots.app, "Cargo.lock"),
      lock(["app", "mid", "core", dependency]),
    );
    await fsp.writeFile(path.join(roots.unrelated, "Cargo.lock"), lock(["unrelated"]));

    await fsp.writeFile(
      path.join(roots.core, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_library")',
        'rust_library(name="core", srcs=["src/lib.rs"], visibility=["PUBLIC"])',
        'rust_binary(name="sibling", crate="core", srcs=["src/sibling.rs"])',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(roots.mid, "TARGETS"),
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")\nrust_library(name="mid", srcs=["src/lib.rs"], deps=["//projects/libs/patch_core:core"], visibility=["PUBLIC"])\n',
    );
    await fsp.writeFile(
      path.join(roots.app, "TARGETS"),
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")\nrust_binary(name="app", srcs=["src/main.rs"], deps=["//projects/libs/patch_mid:mid"])\n',
    );
    await fsp.writeFile(
      path.join(roots.unrelated, "TARGETS"),
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")\nrust_library(name="unrelated", srcs=["src/lib.rs"])\n',
    );
    const app = "//projects/apps/patch_app:app";
    const sibling = "//projects/libs/patch_core:sibling";
    const unrelated = "//projects/libs/patch_unrelated:unrelated";
    const buildTarget = async (target: string) => {
      const result = await runBuildSelected({
        tmp,
        $,
        target,
        source: "path",
        reject: true,
        nothrow: false,
      });
      const outPath = String(result.stdout).trim().split("\n").at(-1);
      assert.ok(outPath, `selected build returned no output: ${String(result.stderr)}`);
      return outPath;
    };
    const runApp = async (outPath: string) => {
      const executable = path.join(outPath, "bin", "app");
      const run = await $({ cwd: tmp, stdio: "pipe" })`${executable}`;
      return String(run.stdout).trim();
    };

    await exportGraphInTemp({ tmp, $ });
    const baseline = {
      app: await buildTarget(app),
      sibling: await buildTarget(sibling),
      unrelated: await buildTarget(unrelated),
    };
    assert.equal(await runApp(baseline.app), "1");
    const importExpression = `let f = builtins.getFlake ${JSON.stringify(
      `path:${path.join(tmp, ".viberoots/workspace")}`,
    )}; pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem}; in pkgs.rustPlatform.importCargoLock { lockFile = ${JSON.stringify(
      path.join(roots.core, "Cargo.lock"),
    )}; }`;
    const imported = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build --impure --no-link --print-out-paths --expr ${importExpression}`;
    const storePath = path.join(String(imported.stdout).trim(), `${dependency}-${version}`);
    const hashed = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix hash path --type sha256 --sri ${storePath}`;
    const narHash = String(hashed.stdout).trim();
    const fixedAuthority = { source, checksum, storePath, narHash };
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
    await $({
      cwd: tmp,
      env,
    })`${cli} start rust ${dependency} --target //projects/libs/patch_core:core`;
    const sessions = JSON.parse(await fsp.readFile(path.join(tmp, ".patch-sessions.json"), "utf8"));
    const workspace = sessions.sessions.rust[key].workspacePath as string;
    await fsp.writeFile(
      path.join(workspace, "src/lib.rs"),
      'pub struct Buffer;\nimpl Buffer { pub fn new() -> Self { Self } pub fn format<I>(&mut self, _: I) -> &str { "2" } }\n',
    );
    await $({
      cwd: tmp,
      env,
    })`${cli} apply rust ${dependency} --target //projects/libs/patch_core:core`;

    await exportGraphInTemp({ tmp, $ });
    const applied = {
      app: await buildTarget(app),
      sibling: await buildTarget(sibling),
      unrelated: await buildTarget(unrelated),
    };
    assert.equal(await runApp(applied.app), "2");
    assert.notEqual(applied.app, baseline.app);
    assert.notEqual(applied.sibling, baseline.sibling);
    assert.equal(applied.unrelated, baseline.unrelated);

    await $({
      cwd: tmp,
      env,
    })`${cli} start rust ${dependency} --target //projects/libs/patch_core:core`;
    await $({
      cwd: tmp,
      env,
    })`${cli} remove rust ${dependency} --target //projects/libs/patch_core:core`;
    await exportGraphInTemp({ tmp, $ });
    const removed = {
      app: await buildTarget(app),
      sibling: await buildTarget(sibling),
      unrelated: await buildTarget(unrelated),
    };
    assert.equal(await runApp(removed.app), "1");
    assert.deepEqual(removed, baseline);
  });
});
