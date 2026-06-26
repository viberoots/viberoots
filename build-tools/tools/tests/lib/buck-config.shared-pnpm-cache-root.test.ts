#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureBuckConfigForTempRepo } from "./test-helpers/buck-config";

test("temp repo buck config propagates shared pnpm hash cache root into actions", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-config-shared-pnpm-cache-"));
  const durableRoot = path.join(tmp, "durable-cache-root");
  const prevSharedRoot = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  const prevSharedPrelude = process.env.VBR_SHARED_PRELUDE_PATH;
  process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = durableRoot;
  process.env.VBR_SHARED_PRELUDE_PATH = path.join(process.cwd(), "viberoots", "prelude");
  try {
    await ensureBuckConfigForTempRepo(tmp, $);
    const buckConfig = await fsp.readFile(path.join(tmp, ".buckconfig"), "utf8");
    assert.match(
      buckConfig,
      /\baction_env = .*VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT\b/,
      "nested Buck actions must receive the durable shared pnpm hash cache root",
    );
    const workspaceRootEnv = await fsp.readFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "workspace-root.env"),
      "utf8",
    );
    assert.match(
      workspaceRootEnv,
      new RegExp(
        `^VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT=${durableRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "m",
      ),
      "workspace-root.env must preserve the durable shared pnpm hash cache root",
    );
  } finally {
    if (prevSharedRoot === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = prevSharedRoot;
    if (prevSharedPrelude === undefined) delete process.env.VBR_SHARED_PRELUDE_PATH;
    else process.env.VBR_SHARED_PRELUDE_PATH = prevSharedPrelude;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
