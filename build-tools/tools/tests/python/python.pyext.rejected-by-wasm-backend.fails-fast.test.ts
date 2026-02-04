#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python: wasm backend rejects pyext in dependency closure (fail fast)", async () => {
  await runInTemp("python-wasm-rejects-pyext", async (tmp, $) => {
    const appRel = path.join("apps", "pywasm");
    const appDir = path.join(tmp, appRel);
    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      '[[package]]\nname = "hello"\nversion = "1.0.0"\n',
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "bin", "__main__.py"), "print('hello')\n", "utf8");

    const relPosix = appRel.replace(/\\/g, "/");
    const wasmLabel = `//${relPosix}:pyapp`;
    const extLabel = `//${relPosix}:ext`;

    await fs.mkdirp(path.join(tmp, "build-tools", "tools", "buck"));
    await fs.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      JSON.stringify(
        [
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.cpp`],
            deps: [],
            link_deps: [],
            header_deps: [],
            link_closure: "direct",
            link_closure_overrides: {},
            cflags: [],
            ldflags: [],
            build_py_deps: [],
          },
          {
            name: wasmLabel,
            rule_type: "python_library",
            labels: ["lang:python", "kind:wasm", "backend:wasi"],
            srcs: [`${relPosix}/bin/__main__.py`],
            deps: [extLabel],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: {
        ...process.env,
        BUCK_TARGET: wasmLabel,
        BUCK_TEST_SRC: tmp,
        WORKSPACE_ROOT: tmp,
      },
    })`nix eval --impure -L --accept-flake-config --raw ${`path:${tmp}#graph-generator-selected.drvPath`}`;

    assert.notEqual(res.exitCode, 0, "expected nix build to fail");
    const stderr = String(res.stderr || "");
    assert.match(stderr, /kind:wasm target .* depends on kind:pyext targets/i);
    assert.match(stderr, new RegExp(extLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
