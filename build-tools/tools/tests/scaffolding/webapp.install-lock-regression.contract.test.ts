#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withExclusiveInstallLock } from "../../dev/install/lock";
import {
  assertWatcherFailureContract,
  assertWorkspaceLinkedDependency,
  isWorkspaceLinkedSpec,
} from "./lib/wasm-watch";

function lockPathForScope(key: string, scopeRootAbs: string): string {
  const h = crypto
    .createHash("sha256")
    .update(`${scopeRootAbs}::${key}`)
    .digest("hex")
    .slice(0, 16);
  const base =
    process.platform === "win32"
      ? path.join(os.tmpdir(), "viberoots-locks")
      : "/tmp/viberoots-locks";
  return path.join(base, `lock-${h}.lck`);
}

test("stale install-lock contract removes orphaned lock deterministically", async () => {
  const scopeRootAbs = await fsp.mkdtemp(path.join(os.tmpdir(), "install-lock-regression-"));
  const key = `install-lock-test-${Date.now()}-${process.pid}`;
  const lockPath = lockPathForScope(key, scopeRootAbs);
  await fsp.mkdir(lockPath, { recursive: true });
  await fsp.writeFile(
    path.join(lockPath, "owner.json"),
    JSON.stringify({ pid: 999_999_999, startedAt: "1970-01-01T00:00:00.000Z" }) + "\n",
    "utf8",
  );
  try {
    let acquired = false;
    await withExclusiveInstallLock(
      key,
      async () => {
        acquired = true;
      },
      { timeoutMs: 1500, staleMs: 900_000, scopeRootAbs },
    );
    assert.equal(acquired, true);
  } finally {
    await fsp.rm(scopeRootAbs, { recursive: true, force: true });
    await fsp.rm(lockPath, { recursive: true, force: true });
  }
});

test("watcher failure helper enforces deterministic failure signature", async () => {
  const okLogs = [
    "[wasm-watch] rebuild:start seq=1 reason=source-change",
    "[wasm-watch] rebuild:fail seq=1 elapsed_ms=42",
    "[wasm-watch] recovery: run this command manually:",
  ].join("\n");
  assert.doesNotThrow(() => assertWatcherFailureContract(okLogs));
  assert.throws(
    () => assertWatcherFailureContract("[wasm-watch] rebuild:start seq=1"),
    /missing watcher failure marker/,
  );
  assert.throws(
    () => assertWatcherFailureContract("[wasm-watch] rebuild:fail seq=1"),
    /missing watcher recovery marker/,
  );
});

test("missing local-link helper reports deterministic recovery guidance", async () => {
  assert.equal(isWorkspaceLinkedSpec("workspace:*"), true);
  assert.equal(isWorkspaceLinkedSpec("link:../demo-lib"), true);
  assert.equal(isWorkspaceLinkedSpec("file:../../libs/demo-lib"), true);
  assert.equal(isWorkspaceLinkedSpec("^1.0.0"), false);
  assert.equal(isWorkspaceLinkedSpec(""), false);

  assert.doesNotThrow(() =>
    assertWorkspaceLinkedDependency({ "@libs/demo-lib": "workspace:*" }, "@libs/demo-lib"),
  );
  assert.throws(
    () => assertWorkspaceLinkedDependency({ "@libs/demo-lib": "^1.0.0" }, "@libs/demo-lib"),
    /recovery: verify importer dependency uses workspace:, link:, or file:, then restart `pnpm run dev`/,
  );
});

test("historical SSR plan docs mark express scaffold as removed", async () => {
  const webappSsrPlan = await fsp.readFile("docs/build-history/webapp-ssr.md", "utf8");
  assert.match(webappSsrPlan, /historical plan record/i);
  assert.match(webappSsrPlan, /does not include `webapp-ssr-express`/);
  assert.match(webappSsrPlan, /Use `webapp-ssr-vite` or `webapp-ssr-next`/);

  const viteSsrPlan = await fsp.readFile("docs/build-history/vite-ssr.md", "utf8");
  assert.match(viteSsrPlan, /historical plan record/i);
  assert.match(viteSsrPlan, /does not include `webapp-ssr-express`/);
  assert.match(viteSsrPlan, /Use `webapp-ssr-vite` or `webapp-ssr-next`/);
});
