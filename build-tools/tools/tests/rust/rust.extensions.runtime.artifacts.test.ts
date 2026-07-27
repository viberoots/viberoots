#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  buildSelectedOutPath,
  reconcileTempDependencyInputs,
  runBuildSelected,
  runInTemp,
  workspaceFlakeRef,
} from "../lib/test-helpers";
import { writeRustExtensionRuntimeFixture } from "./rust-extension-runtime-fixture";

test("Rust CPython and Node extensions execute through managed runtimes and call C", async () => {
  await runInTemp("rust-managed-runtime-extensions", async (tmp, $) => {
    await writeRustExtensionRuntimeFixture(tmp);
    await fs.writeFile(
      path.join(tmp, "projects/libs/rust_pyext/pyproject.toml"),
      '[project]\nname = "rust-pyext-build"\nversion = "0.1.0"\ndependencies = ["packaging==25.0"]\n',
    );
    await fs.appendFile(
      path.join(tmp, "projects/libs/rust_pyext/TARGETS"),
      'rust_python_extension(name="extension_with_pydep", module="demo._native", crate="rust_pyext", srcs=["build.rs", "src/lib.rs"], build_py_deps=["packaging"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/extension-c:answer"])\n',
    );
    const packagingRoot = path.join(tmp, "python-build-packaging");
    await fs.mkdir(path.join(packagingRoot, "packaging"), { recursive: true });
    await fs.writeFile(path.join(packagingRoot, "packaging/__init__.py"), "__version__ = '25.0'\n");
    const appRoot = path.join(tmp, "projects/apps/rust-python-consumer");
    await fs.mkdir(path.join(appRoot, "bin"), { recursive: true });
    await fs.writeFile(
      path.join(appRoot, "pyproject.toml"),
      '[project]\nname = "rust-python-consumer"\nversion = "0.1.0"\ndependencies = []\n',
    );
    await fs.writeFile(
      path.join(appRoot, "bin/__main__.py"),
      "import demo._native as native\nassert native.answer() == 42\nprint(native.answer())\n",
    );
    await fs.writeFile(
      path.join(appRoot, "TARGETS"),
      [
        'load("@viberoots//build-tools/python:defs.bzl", "nix_python_binary")',
        'nix_python_binary(name="app", main="bin/__main__.py",',
        '  deps=["//projects/libs/rust_pyext:extension"])',
        "",
      ].join("\n"),
    );
    await reconcileTempDependencyInputs(tmp, $);
    const pyOut = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/rust_pyext:extension",
    });
    const nodeOut = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/rust_addon:addon",
    });
    const node9Out = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/rust_addon:addon9",
    });
    const node10Out = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/rust_addon:addon10",
    });
    const pyDepTarget = "//projects/libs/rust_pyext:extension_with_pydep";
    const nix = path.join(String(process.env.VBR_ARTIFACT_TOOLS_ROOT), "bin/nix");
    const pyDepBuild = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
        BUCK_TARGET: pyDepTarget,
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          packaging: { version: "25.0", originPath: packagingRoot },
        }),
      },
    })`${nix} build --impure --accept-flake-config --builders "" --no-link --print-out-paths ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`}`;
    const pyDepOut = String(pyDepBuild.stdout).trim().split(/\n+/).pop()!;
    await fs.access(path.join(pyDepOut, "site/demo"));
    const pyAppOut = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/apps/rust-python-consumer:app",
    });
    const pyAppBin = path.join(pyAppOut, "bin", (await fs.readdir(path.join(pyAppOut, "bin")))[0]!);
    const pyAppProbe = await $({ cwd: tmp, stdio: "pipe" })`${pyAppBin}`;
    assert.equal(String(pyAppProbe.stdout).trim(), "42");
    const site = path.join(pyOut, "site");
    const pyFiles = await fs.readdir(path.join(site, "demo"));
    assert.equal(
      pyFiles.filter((file) => file.startsWith("_native") && file.endsWith(".so")).length,
      1,
    );
    assert.ok((await fs.readdir(path.join(site, "demo/runtime"))).length >= 2);
    const python = path.join(String(process.env.VBR_ARTIFACT_TOOLS_ROOT), "bin/python3");
    const probeScript = path.join(tmp, "probe-extension.py");
    await fs.writeFile(
      probeScript,
      [
        "import demo._native as native",
        "assert native.answer() == 42",
        "try:",
        "    native.raise_error()",
        "except ValueError as error:",
        "    assert str(error) == 'rust extension error'",
        "else:",
        "    raise AssertionError('missing translated ValueError')",
        "",
      ].join("\n"),
    );
    const pyProbe = await $({
      cwd: tmp,
      env: { ...process.env, PYTHONPATH: site, PYTHONNOUSERSITE: "1" },
      stdio: "pipe",
    })`${python} ${probeScript}`;
    assert.equal(pyProbe.exitCode, 0);
    const addon = path.join(nodeOut, "lib", "rust_native.node");
    assert.ok((await fs.stat(addon)).size > 0);
    assert.ok((await fs.readdir(path.join(nodeOut, "lib/runtime"))).length >= 2);
    const nodeProbe = await $({ cwd: tmp, stdio: "pipe" })`${process.execPath} -e ${[
      "const addon = require(process.argv[1])",
      "if (addon.answer() !== 42) process.exit(2)",
      "if (addon.napiVersion() !== 8) process.exit(3)",
      "if (addon.napiConformance() !== 8) process.exit(5)",
      "if (Number(process.versions.napi) < addon.napiVersion()) process.exit(4)",
    ].join("; ")} ${addon}`;
    assert.equal(nodeProbe.exitCode, 0);
    for (const [output, name, version] of [
      [node9Out, "rust_native9.node", 9],
      [node10Out, "rust_native10.node", 10],
    ] as const) {
      const versionedAddon = path.join(output, "lib", name);
      const probe = await $({ cwd: tmp, stdio: "pipe" })`${process.execPath} -e ${[
        "const addon = require(process.argv[1])",
        `if (addon.napiVersion() !== ${version}) process.exit(2)`,
        `if (addon.napiConformance() !== ${version}) process.exit(3)`,
      ].join("; ")} ${versionedAddon}`;
      assert.equal(probe.exitCode, 0);
    }
    const mismatchedNapi = await runBuildSelected({
      tmp,
      $,
      target: "//projects/libs/rust_addon:addon_mismatch",
      stdio: "pipe",
    });
    assert.notEqual(mismatchedNapi.exitCode, 0);
    assert.match(
      `${String(mismatchedNapi.stdout || "")}\n${String(mismatchedNapi.stderr || "")}`,
      /declares Node-API 8 but binary getter returned 10/,
    );
    const badAbi = await runBuildSelected({
      tmp,
      $,
      target: "//projects/libs/rust_pyext:bad_abi",
      stdio: "pipe",
    });
    assert.notEqual(badAbi.exitCode, 0);
    assert.match(
      `${String(badAbi.stdout || "")}\n${String(badAbi.stderr || "")}`,
      /Python extension ABI cp00 does not match selected cp\d+/,
    );
  });
});
