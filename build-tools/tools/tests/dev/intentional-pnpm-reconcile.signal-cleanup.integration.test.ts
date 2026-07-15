#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SOURCE_ROOT = path.resolve(import.meta.dirname, "../../../..");
const NODE_RUN = path.join(SOURCE_ROOT, "build-tools/tools/lib/node-run.ts");
const CLEANUP = path.join(
  SOURCE_ROOT,
  "build-tools/tools/dev/update-pnpm-hash/invalid-store-cleanup.ts",
);
const CANCELLATION = path.join(SOURCE_ROOT, "build-tools/tools/lib/managed-cancellation.ts");
const ZX_INIT = path.join(SOURCE_ROOT, "build-tools/tools/dev/zx-init.mjs");

async function waitFor(file: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await fsp.access(file).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function spawnOuter(
  root: string,
  outerScript: string,
  detached: boolean,
): Promise<{
  child: ReturnType<typeof spawn>;
  diagnostics: () => string;
}> {
  let output = "";
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      ZX_INIT,
      outerScript,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached },
  );
  child.stdout?.on("data", (chunk) => (output += String(chunk)));
  child.stderr?.on("data", (chunk) => (output += String(chunk)));
  return { child, diagnostics: () => output };
}

async function writeOuter(root: string, childScript: string, name = "outer.ts"): Promise<string> {
  const outerScript = path.join(root, name);
  await fsp.writeFile(
    outerScript,
    `
import { runNodeWithZx } from ${JSON.stringify(NODE_RUN)};
await runNodeWithZx({
  script: ${JSON.stringify(childScript)},
  cwd: ${JSON.stringify(root)},
  zxInitPath: ${JSON.stringify(ZX_INIT)},
  awaitChildOnSignal: true,
  signalCleanupGraceMs: 5_000,
  stdio: "pipe",
});
`,
  );
  return outerScript;
}

async function waitForClose(child: ReturnType<typeof spawn>) {
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
}

test("outer reconcile signal awaits owned invalid cleanup and preserves the signal", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-reconcile-signal-"));
  const ready = path.join(root, "ready");
  const result = path.join(root, "result.json");
  const childScript = path.join(root, "cleanup-child.ts");
  const derivationName = `pnpm-store-lock-${"a".repeat(64)}`;
  const grown = `/nix/store/${"b".repeat(32)}-${derivationName}`;
  const created = `/nix/store/${"c".repeat(32)}-${derivationName}`;
  const valid = `/nix/store/${"d".repeat(32)}-${derivationName}`;
  const unowned = `/nix/store/${"e".repeat(32)}-unowned`;

  await fsp.writeFile(
    childScript,
    `
import * as fsp from "node:fs/promises";
import { cleanupChangedOwnedInvalidPnpmStores, snapshotOwnedInvalidPnpmStores } from ${JSON.stringify(CLEANUP)};
import { initializeManagedCancellationChannel, onManagedCancellation } from ${JSON.stringify(CANCELLATION)};
initializeManagedCancellationChannel();
const derivationName = ${JSON.stringify(derivationName)};
const entries = new Map([
  [${JSON.stringify(grown)}, { sizeKib: 1, mtimeMs: 1, valid: false }],
  [${JSON.stringify(valid)}, { sizeKib: 4, mtimeMs: 1, valid: true }],
  [${JSON.stringify(unowned)}, { sizeKib: 4, mtimeMs: 1, valid: false }],
]);
const deleted = [];
const deps = {
  listStoreEntries: async () => [...entries.keys()].map((entry) => entry.split("/").pop()),
  isValid: async (storePath) => entries.get(storePath)?.valid === true,
  evidence: async (storePath) => entries.get(storePath),
  referrers: async () => [],
  roots: async () => [],
  openOwners: async () => [],
  deletePath: async (storePath) => { deleted.push(storePath); entries.delete(storePath); },
};
const before = await snapshotOwnedInvalidPnpmStores({ derivationName, deps });
entries.set(${JSON.stringify(grown)}, { sizeKib: 2, mtimeMs: 2, valid: false });
entries.set(${JSON.stringify(created)}, { sizeKib: 1, mtimeMs: 2, valid: false });
onManagedCancellation(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await cleanupChangedOwnedInvalidPnpmStores({ derivationName, before, deps });
  await fsp.writeFile(${JSON.stringify(result)}, JSON.stringify({ deleted, remaining: [...entries.keys()] }));
  process.exit(143);
});
await fsp.writeFile(${JSON.stringify(ready)}, "ready");
setInterval(() => {}, 1_000);
await new Promise(() => {});
`,
  );

  try {
    const outerScript = await writeOuter(root, childScript);
    const outer = await spawnOuter(root, outerScript, true);
    await waitFor(ready).catch((error) => {
      throw new Error(`${String(error)}\n${outer.diagnostics()}`);
    });
    assert.ok(outer.child.pid);
    process.kill(-outer.child.pid!, "SIGTERM");
    assert.deepEqual(await waitForClose(outer.child), { code: null, signal: "SIGTERM" });
    const cleanupResult = JSON.parse(await fsp.readFile(result, "utf8")) as {
      deleted: string[];
      remaining: string[];
    };
    assert.deepEqual(cleanupResult.deleted.sort(), [created, grown].sort());
    assert.deepEqual(cleanupResult.remaining.sort(), [unowned, valid].sort());
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("managed cancellation IPC does not hold a successful child open", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-reconcile-success-"));
  const childScript = path.join(root, "success-child.ts");
  await fsp.writeFile(
    childScript,
    `import { initializeManagedCancellationChannel } from ${JSON.stringify(CANCELLATION)};\ninitializeManagedCancellationChannel();\n`,
  );

  try {
    const outerScript = await writeOuter(root, childScript);
    const outer = await spawnOuter(root, outerScript, false);
    const closed = await waitForClose(outer.child);
    assert.deepEqual(closed, { code: 0, signal: null }, outer.diagnostics());
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("late cancellation after managed work unsubscribes still lets the child close", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-reconcile-late-cancel-"));
  const ready = path.join(root, "ready");
  const cancelObserved = path.join(root, "cancel-observed");
  const release = path.join(root, "release");
  const childScript = path.join(root, "late-cancel-child.ts");
  await fsp.writeFile(
    childScript,
    `
import * as fsp from "node:fs/promises";
import { closeManagedCancellationChannel, initializeManagedCancellationChannel, onManagedCancellation } from ${JSON.stringify(CANCELLATION)};
initializeManagedCancellationChannel();
const remove = onManagedCancellation(() => {});
remove();
process.on("message", async (message) => {
  if (message?.type === "viberoots-managed-cancel-request") {
    await fsp.writeFile(${JSON.stringify(cancelObserved)}, "observed");
  }
});
await fsp.writeFile(${JSON.stringify(ready)}, "ready");
while (!(await fsp.access(${JSON.stringify(release)}).then(() => true, () => false))) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
closeManagedCancellationChannel();
`,
  );

  try {
    const outerScript = await writeOuter(root, childScript);
    const outer = await spawnOuter(root, outerScript, true);
    await waitFor(ready).catch((error) => {
      throw new Error(`${String(error)}\n${outer.diagnostics()}`);
    });
    assert.ok(outer.child.pid);
    outer.child.kill("SIGTERM");
    await waitFor(cancelObserved).catch((error) => {
      throw new Error(`${String(error)}\n${outer.diagnostics()}`);
    });
    await fsp.writeFile(release, "release");
    assert.deepEqual(await waitForClose(outer.child), { code: null, signal: "SIGTERM" });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
