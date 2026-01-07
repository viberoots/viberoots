#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function showOutputPath(tmp: string, $: any, target: string, iso: string): Promise<string> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 --isolation-dir ${iso} targets --target-platforms //:no_cgo --show-output ${target}`;
  if (res.exitCode !== 0) return "";
  const line =
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)
      .find((l) => l.includes(target.replace(/^\/\//, "").split(":")[0] || "")) ||
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)[0] ||
    "";
  const outPath = (line.split(/\s+/)[1] || "").trim();
  return outPath && path.isAbsolute(outPath) ? outPath : outPath ? path.join(tmp, outPath) : "";
}

test("python: importer-local patch change triggers rebuild of python binary", async () => {
  await runInTemp("py-invalidation-patch-rebuilds-binary", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    const patchDir = path.join(appDir, "patches", "python");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    const patchFile = path.join(patchDir, "base@0.0.0.patch");
    await fsp.writeFile(patchFile, "# baseline\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "python_library")',
        'load("//python:defs.bzl", "nix_python_binary")',
        "",
        "python_library(",
        '  name = "lib",',
        '  srcs = ["src/main.py"],',
        ")",
        "",
        "nix_python_binary(",
        '  name = "bin",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        '  main = "src/main.py",',
        '  deps = [":lib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const iso1 = `py-inval-1-${process.pid}-${Date.now()}`;
    const iso2 = `py-inval-2-${process.pid}-${Date.now()}`;

    await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 --isolation-dir ${iso1} build --no-remote-cache --target-platforms //:no_cgo //apps/demo:bin`;

    const hashTarget = "//apps/demo:bin__patch_inputs_hash";
    const hashOut1 = await showOutputPath(tmp, $, hashTarget, iso1);
    if (!hashOut1) {
      console.error("could not determine output path for", hashTarget);
      process.exit(2);
    }
    const hash1 = await fsp.readFile(hashOut1, "utf8").then((s) => s.trim());

    await fsp.appendFile(patchFile, "# change\n", "utf8");

    await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 --isolation-dir ${iso2} build --no-remote-cache --target-platforms //:no_cgo //apps/demo:bin`;

    const hashOut2 = await showOutputPath(tmp, $, hashTarget, iso2);
    if (!hashOut2) {
      console.error("could not determine output path for", hashTarget, "after patch change");
      process.exit(2);
    }
    const hash2 = await fsp.readFile(hashOut2, "utf8").then((s) => s.trim());
    if (hash1 === hash2) {
      console.error("expected patch hash stamp output to change after importer-local patch edit");
      console.error("before:", JSON.stringify(hash1));
      console.error("after: ", JSON.stringify(hash2));
      process.exit(2);
    }
  });
});
