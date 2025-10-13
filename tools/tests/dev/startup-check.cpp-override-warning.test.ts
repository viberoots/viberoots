#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import path from "node:path";

test("startup-check warns for C++ overrides locally", async () => {
  const here = new URL(import.meta.url).pathname;
  const zxInit = path.resolve(path.dirname(here), "../../dev/zx-init.mjs");
  const nodeFlags = [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    `--import ${zxInit}`,
  ].join(" ");
  const env = {
    ...process.env,
    NIX_CPP_DEV_OVERRIDE_JSON: '{"pkgs.zlib":"/tmp/ws"}',
    NODE_OPTIONS: [nodeFlags, process.env.NODE_OPTIONS || ""].filter(Boolean).join(" "),
  } as Record<string, string>;
  let out = "";
  try {
    const { stdout, stderr } = await $({ stdio: "pipe", env })`node tools/dev/startup-check.ts`;
    out = String(stdout || "") + String(stderr || "");
  } catch (e: any) {
    out = String(e?.stdout || "") + String(e?.stderr || "");
  }
  if (!out.includes("NIX_CPP_DEV_OVERRIDE_JSON is set")) {
    console.error("expected NIX_CPP_DEV_OVERRIDE_JSON warning in startup-check output\n", out);
    process.exit(2);
  }
});
