#!/usr/bin/env zx-wrapper
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInTemp } from "../lib/test-helpers";

const startupCheckScript = fileURLToPath(new URL("../../dev/startup-check.ts", import.meta.url));

// Python-enabled checkouts require the Nix-provided toolchain locally as well as in CI.
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
    })`${node} ${startupCheckScript}`;
    out = String(stdout || "") + String(stderr || "");
  } catch (e: any) {
    code = e?.exitCode || 1;
    out = String(e?.stdout || "") + String(e?.stderr || "");
  }

  if (code === 0) {
    console.error("expected startup-check to fail locally when python3/uv are missing\n", out);
    process.exit(2);
  }
  if (!out.includes("Python toolchain must come from the Nix dev shell")) {
    console.error("expected the local failure to identify the Nix Python requirement\n", out);
    process.exit(2);
  }
});
