#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function whatRanIdentities(tmp: string, $: any, eventLogPath: string): Promise<string[]> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 log what-ran --format json ${eventLogPath}`;
  if (res.exitCode !== 0) return [];
  const lines = String(res.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    try {
      const obj: any = JSON.parse(line);
      if (obj && typeof obj.identity === "string" && obj.identity) out.push(obj.identity);
    } catch {
      // ignore non-json lines
    }
  }
  return out;
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

    const ev1 = path.join(tmp, "buck-out", "ev1.json-lines");
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --no-remote-cache --target-platforms //:no_cgo --event-log ${ev1} //apps/demo:bin`;
    const ran1 = await whatRanIdentities(tmp, $, ev1);

    await fsp.appendFile(patchFile, "# change\n", "utf8");
    await $`buck2 kill`.nothrow();

    const ev2 = path.join(tmp, "buck-out", "ev2.json-lines");
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --no-remote-cache --target-platforms //:no_cgo --event-log ${ev2} //apps/demo:bin`;
    const ran2 = await whatRanIdentities(tmp, $, ev2);

    const touched = "apps/demo:bin";
    const touchedHelper = "apps/demo:bin__patch_inputs";
    const identityMentionsTarget = (s: string) => s.includes(touched) || s.includes(touchedHelper);
    const ranTargetActions = ran2.some(identityMentionsTarget);
    if (!ranTargetActions) {
      console.error(
        "expected at least one executed command associated with",
        touched,
        "after patch change",
      );
      console.error("ran1_count:", ran1.length, "ran2_count:", ran2.length);
      console.error("ran2_identities_sample:", ran2.slice(0, 10));
      process.exit(2);
    }
  });
});
