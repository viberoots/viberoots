#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go start creates session and workspace (idempotent)", async () => {
  await runInTemp("patch-go-start", async (tmp, $) => {
    // Prepare fake pristine source and resolver mapping
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fs.mkdirp(origin);
    await fs.outputFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };

    // Ensure CLI is executable
    await $`chmod +x tools/bin/patch-pkg`;

    // First start
    const r1 = await $({ cwd: tmp })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg start go golang.org/x/net`;
    const ws1 = String(r1.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!ws1) {
      console.error("missing workspace path in stdout");
      process.exit(2);
    }

    // Session file
    const storePath = path.join(tmp, ".patch-sessions.json");
    const store = JSON.parse(await fs.readFile(storePath, "utf8"));
    if (!store?.sessions?.go?.["golang.org/x/net@v0.24.0"]) {
      console.error("session record missing for golang.org/x/net@v0.24.0");
      process.exit(2);
    }

    // Second start should be idempotent and print the same workspace
    const r2 = await $({ cwd: tmp })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg start go golang.org/x/net`;
    const ws2 = String(r2.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (ws2 !== ws1) {
      console.error("idempotent start returned different workspace path");
      process.exit(2);
    }
  });
});
