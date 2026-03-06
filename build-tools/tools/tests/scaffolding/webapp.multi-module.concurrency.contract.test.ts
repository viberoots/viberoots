#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { stopServer } from "./lib/webapp-static-hmr";
import { assertSingleQueueInvariant } from "./lib/wasm-watch";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await sleep(pollMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

async function writeAndTouch(filePath: string, text: string): Promise<void> {
  await fsp.writeFile(filePath, text, "utf8");
  const stamp = new Date(Date.now() + 1200);
  await fsp.utimes(filePath, stamp, stamp);
}

test(
  "PR-2 concurrency: manifest-driven watcher handles 5 module keys fairly in one session",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const repoRoot = process.cwd();
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-multi-module-watch-"));
    const moduleKeys = ["a", "b", "c", "d", "e"];
    const wasmManifestRel = "src/wasm-modules.manifest.json";
    const tsManifestRel = "src/ts-modules.manifest.json";
    const payloadByKey = new Map(
      moduleKeys.map((key) => [key, path.join(tempRoot, "src", "wasm-producer", `${key}.txt`)]),
    );
    const contractByKey = new Map(
      moduleKeys.map((key) => [key, path.join(tempRoot, "src", "wasm-contract", `${key}.wasm`)]),
    );
    await fsp.mkdir(path.join(tempRoot, "src", "wasm-producer"), { recursive: true });
    await fsp.mkdir(path.join(tempRoot, "src", "wasm-contract"), { recursive: true });
    await fsp.mkdir(path.join(tempRoot, "src", "ts-modules"), { recursive: true });
    await fsp.writeFile(
      path.join(tempRoot, "src", "ts-modules", "client.ts"),
      "export const v = 'c';\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tempRoot, "src", "ts-modules", "server.ts"),
      "export const v = 's';\n",
      "utf8",
    );
    for (const key of moduleKeys) {
      const payloadPath = payloadByKey.get(key);
      if (!payloadPath) throw new Error(`missing payload path for key ${key}`);
      await fsp.writeFile(payloadPath, `${key}-0`, "utf8");
    }
    await fsp.writeFile(
      path.join(tempRoot, wasmManifestRel),
      JSON.stringify(
        {
          defaultModuleKey: moduleKeys[0],
          modules: moduleKeys.map((key) => ({
            moduleKey: key,
            sourcePath: `src/wasm-contract/${key}.wasm`,
            runtimeDestinations: {
              client: `${key}.wasm`,
              server: `server/wasm/${key}.wasm`,
            },
          })),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tempRoot, tsManifestRel),
      JSON.stringify(
        {
          defaultModuleKey: "client",
          modules: [
            {
              moduleKey: "client",
              sourceEntryPath: "src/ts-modules/client.ts",
              runtimeImportPath: "./ts-modules/client",
            },
            {
              moduleKey: "server",
              sourceEntryPath: "src/ts-modules/server.ts",
              runtimeImportPath: "./ts-modules/server",
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const watcherAbs = path.join(repoRoot, "build-tools", "tools", "dev", "watch-wasm-producer.ts");
    const logs: string[] = [];
    const watcher = spawn(
      "zx-wrapper",
      [
        watcherAbs,
        "--cwd",
        tempRoot,
        "--wasm-manifest",
        wasmManifestRel,
        "--ts-manifest",
        tsManifestRel,
        "--poll-ms",
        "120",
      ],
      { cwd: tempRoot, stdio: "pipe", env: process.env },
    );
    watcher.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
    watcher.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));

    try {
      await waitFor(
        async () => {
          for (const key of moduleKeys) {
            const filePath = contractByKey.get(key);
            if (!filePath) return false;
            try {
              const body = await fsp.readFile(filePath, "utf8");
              if (!body.includes(`${key}-0`)) return false;
            } catch {
              return false;
            }
          }
          return true;
        },
        60000,
        150,
      );

      for (const key of moduleKeys) {
        const payloadPath = payloadByKey.get(key);
        if (!payloadPath) throw new Error(`missing payload path for key ${key}`);
        await writeAndTouch(payloadPath, `${key}-1`);
      }
      await waitFor(
        async () => {
          for (const key of moduleKeys) {
            const filePath = contractByKey.get(key);
            if (!filePath) return false;
            try {
              const body = await fsp.readFile(filePath, "utf8");
              if (!body.includes(`${key}-1`)) return false;
            } catch {
              return false;
            }
          }
          return true;
        },
        90000,
        150,
      );

      const mergedLogs = logs.join("");
      for (const key of moduleKeys) {
        assert.match(
          mergedLogs,
          new RegExp(`module_key=${key}\\b`),
          `missing module-scoped log marker for key ${key}`,
        );
      }
      const sourceChangeLines = mergedLogs
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.includes("[wasm-watch] rebuild:start") && line.includes("reason=source-change"),
        );
      const seenInOrder: string[] = [];
      for (const line of sourceChangeLines) {
        const match = line.match(/module_key=([a-z0-9_-]+)/i);
        const key = match?.[1];
        if (!key || seenInOrder.includes(key)) continue;
        seenInOrder.push(key);
        if (seenInOrder.length >= moduleKeys.length) break;
      }
      assert.deepEqual(
        seenInOrder.sort(),
        [...moduleKeys].sort(),
        "fair scheduling violated: source-change rebuild order did not include all module keys",
      );
      assertSingleQueueInvariant(mergedLogs);
    } finally {
      await stopServer(watcher);
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
