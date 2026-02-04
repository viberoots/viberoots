#!/usr/bin/env zx-wrapper
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

// Locally (CI not set), language toolchains are optional (sparse/partial clones).
// Missing python3/uv should NOT fail and should NOT warn by default.
await runInTemp("startup-check-python-uv-warn-local", async (tmp, $) => {
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
    NODE_OPTIONS: [nodeFlags, process.env.NODE_OPTIONS || ""].filter(Boolean).join(" "),
  } as Record<string, string>;

  let code = 0;
  let out = "";
  try {
    const node = process.execPath || "node";
    const { stdout, stderr } = await $({
      stdio: "pipe",
      env,
    })`${node} build-tools/tools/dev/startup-check.ts`;
    out = String(stdout || "") + String(stderr || "");
  } catch (e: any) {
    code = e?.exitCode || 1;
    out = String(e?.stdout || "") + String(e?.stderr || "");
  }

  if (code !== 0) {
    console.error("expected startup-check to succeed locally when python3/uv are missing\n", out);
    process.exit(2);
  }
  if (out.includes("missing tools") || out.includes("python3") || out.includes("uv")) {
    console.error("expected no python3/uv missing-tools warning in local output\n", out);
    process.exit(2);
  }
});
