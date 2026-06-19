#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInTemp } from "../lib/test-helpers";

const startupCheckScript = fileURLToPath(new URL("../../dev/startup-check.ts", import.meta.url));

// In CI (CI=true), missing python3/uv should FAIL.
await runInTemp("startup-check-python-uv-fail-ci", async (tmp, $) => {
  await fsp.mkdir(path.join(tmp, "build-tools/python"), { recursive: true });
  await fsp.writeFile(path.join(tmp, "build-tools/python/defs.bzl"), "# python fixture\n", "utf8");

  // Ensure zx init is loaded for TypeScript execution
  const here = new URL(import.meta.url).pathname;
  const zxInit = path.resolve(path.dirname(here), "../../dev/zx-init.mjs");
  const nodeFlags = [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    `--import ${zxInit}`,
  ].join(" ");

  const env = {
    ...process.env,
    STARTUP_CHECK_FAKE_MISSING: "python3,uv",
    CI: "true",
    NODE_OPTIONS: [nodeFlags, process.env.NODE_OPTIONS || ""].filter(Boolean).join(" "),
  } as Record<string, string>;

  // Expect failure
  const node = process.execPath || "node";
  const res = await $({
    stdio: "pipe",
    env,
  })`${node} ${startupCheckScript}`.nothrow();
  if (res.exitCode === 0) {
    console.error("expected startup-check to fail in CI when python3/uv are missing\n", res.stdout);
    process.exit(2);
  }
  const out = String(res.stdout || "") + String(res.stderr || "");
  if (!out.includes("python3") || !out.includes("uv")) {
    console.error("expected error mentioning python3 and uv in CI output\n", out);
    process.exit(2);
  }
});
