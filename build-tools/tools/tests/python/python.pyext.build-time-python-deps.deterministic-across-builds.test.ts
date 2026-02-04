#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python: pyext wheelhouse env drvPath depends only on importer uv.lock (not extension sources)", async () => {
  await runInTemp("python-pyext-wheelhouse-drv", async (tmp, _$) => {
    if (!_$) {
      throw new Error("runInTemp did not provide a zx $ helper");
    }
    const $ = _$;

    const appRel = path.join("apps", "pyext_build_deps");
    const appDir = path.join(tmp, appRel);
    await fs.mkdirp(path.join(appDir, "native"));

    // Fake header-providing Python package in vendor/ (resolved by NIX_PY_TEST_RESOLVE_JSON).
    const origin = path.join(appDir, "vendor", "builddep-1.0.0");
    await fs.mkdirp(path.join(origin, "builddep", "include"));
    await fs.writeFile(
      path.join(origin, "builddep", "__init__.py"),
      [
        "import os",
        "",
        "def get_include() -> str:",
        "    return os.path.join(os.path.dirname(__file__), 'include')",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(origin, "builddep", "include", "builddep.h"),
      "#pragma once\n",
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "builddep"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      ["#include <Python.h>", "static int x = 1;", ""].join("\n"),
      "utf8",
    );

    const relPosix = appRel.replace(/\\/g, "/");
    const extLabel = `//${relPosix}:ext`;

    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.c`],
            deps: [],
            cflags: [],
            ldflags: [],
            build_py_deps: ["builddep"],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await $`git add -A`;
    await $`git -c user.name=tmp -c user.email=tmp@example.com commit -m "test: setup"`;

    const resolveJson = JSON.stringify({
      builddep: {
        version: "1.0.0",
        originPath: path.join("apps", "pyext_build_deps", "vendor", "builddep-1.0.0"),
      },
    });
    const baseEnv = {
      ...process.env,
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      BUCK_TARGET: extLabel,
      NIX_PY_TEST_RESOLVE_JSON: resolveJson,
    };

    const flakeAttr = "graph-generator-selected.passthru.wheelhouseEnv.drvPath";
    const drv1 = String(
      (
        await $({
          cwd: tmp,
          env: baseEnv,
          stdio: "pipe",
        })`nix eval --impure --accept-flake-config --raw ${`path:${tmp}#${flakeAttr}`}`
      ).stdout,
    ).trim();
    assert.ok(
      drv1.startsWith("/nix/store/") && drv1.endsWith(".drv"),
      `unexpected drvPath: ${drv1}`,
    );

    // Change extension source (should NOT affect wheelhouse env key).
    await fs.appendFile(path.join(appDir, "native", "ext.c"), "\nstatic int y = 2;\n", "utf8");
    await $`git add -A`;
    await $`git -c user.name=tmp -c user.email=tmp@example.com commit -m "test: change ext src"`;

    const drv2 = String(
      (
        await $({
          cwd: tmp,
          env: baseEnv,
          stdio: "pipe",
        })`nix eval --impure --accept-flake-config --raw ${`path:${tmp}#${flakeAttr}`}`
      ).stdout,
    ).trim();
    assert.equal(
      drv2,
      drv1,
      "expected wheelhouse env drvPath to be stable when only extension sources change",
    );

    // Change lockfile (should affect wheelhouse env key).
    await fs.appendFile(path.join(appDir, "uv.lock"), "\n# changed\n", "utf8");
    await $`git add -A`;
    await $`git -c user.name=tmp -c user.email=tmp@example.com commit -m "test: change lockfile"`;

    const drv3 = String(
      (
        await $({
          cwd: tmp,
          env: baseEnv,
          stdio: "pipe",
        })`nix eval --impure --accept-flake-config --raw ${`path:${tmp}#${flakeAttr}`}`
      ).stdout,
    ).trim();
    assert.notEqual(drv3, drv1, "expected wheelhouse env drvPath to change when uv.lock changes");
  });
});
