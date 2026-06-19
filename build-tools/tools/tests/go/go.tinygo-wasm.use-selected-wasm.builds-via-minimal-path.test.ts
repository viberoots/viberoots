#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

function safeLogKeyFromLabel(label: string): string {
  return label.replace(/\//g, "_").replace(/:/g, "_");
}

test("nix_go_tiny_wasm_lib use_selected_wasm routes to selected-wasm path", async () => {
  await runInTemp("go-tinygo-wasm-use-selected-wasm", async (tmp, $) => {
    const apiDir = path.join(tmp, "projects", "libs", "math-api");
    await fs.mkdirp(apiDir);
    await fs.writeFile(
      path.join(apiDir, "go.mod"),
      "module example.com/math/api\n\ngo 1.22.0\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "main.go"),
      "package main\n\n//export add\nfunc add(a int32, b int32) int32 { return a + b }\n\nfunc main() {}\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '    name = "wasm",',
        '    srcs = ["main.go"],',
        "    use_selected_wasm = True,",
        '    labels = ["lang:go", "kind:wasm"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const label = "//projects/libs/math-api:wasm";
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms prelude//platforms:default --show-output ${label}`;
    assert.equal(build.exitCode, 0, "buck2 build failed");
    const out =
      String(build.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    assert.ok(out, "missing --show-output path for wasm target");
    const absOut = path.isAbsolute(out) ? out : path.join(tmp, out);
    assert.ok(await fs.pathExists(absOut), "expected wasm output to exist");

    const logPath = path.join(
      tmp,
      "buck-out",
      "tmp",
      "build-selected",
      `go_nix_build_wasm_build.${safeLogKeyFromLabel(label)}.log`,
    );
    if (await fs.pathExists(logPath)) {
      const log = await fs.readFile(logPath, "utf8");
      assert.doesNotMatch(log, /\[build-selected\]/);
    }

    const { stdout: outWasmSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: label },
    })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected-wasm`} --accept-flake-config --no-link --print-out-paths`;
    const outWasmPath =
      String(outWasmSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    assert.ok(outWasmPath, "missing selected-wasm out path");
    const tinygoWasm = path.join(outWasmPath, "lib", "top.wasm");
    const ok =
      await $`bash --noprofile --norc -c ${`test -f ${tinygoWasm} && echo ok || true`}`.nothrow();
    if (
      !String(ok.stdout || "")
        .trim()
        .includes("ok")
    ) {
      throw new Error("expected lib/top.wasm under selected-wasm out path");
    }
  });
});
