#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { stopServer } from "./lib/webapp-static-hmr";
import { assertSingleQueueInvariant, waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

function wasmManifest(keys: string[]): string {
  return (
    JSON.stringify(
      {
        defaultModuleKey: keys[0] || "",
        modules: keys.map((key) => ({
          moduleKey: key,
          sourcePath: `src/wasm-contract/${key}.wasm`,
          runtimeDestinations: {
            client: `wasm/${key}.wasm`,
            server: `server/wasm/${key}.wasm`,
          },
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

async function writeTsManifest(root: string): Promise<void> {
  await fsp.writeFile(
    path.join(root, "src", "ts-modules.manifest.json"),
    JSON.stringify(
      {
        defaultModuleKey: "client",
        modules: [
          {
            moduleKey: "client",
            sourceEntryPath: "src/ts-modules/client.ts",
            runtimeImportPath: "./ts-modules/client",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

test(
  "PR-8 in-session refresh enrolls and retires module keys without restart",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const repoRoot = process.cwd();
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-phase5-refresh-"));
    await fsp.mkdir(path.join(tempRoot, "src", "wasm-producer"), { recursive: true });
    await fsp.mkdir(path.join(tempRoot, "src", "wasm-contract"), { recursive: true });
    await fsp.mkdir(path.join(tempRoot, "src", "ts-modules"), { recursive: true });
    await fsp.writeFile(
      path.join(tempRoot, "src", "ts-modules", "client.ts"),
      "export const v = 1;\n",
    );
    await writeTsManifest(tempRoot);
    await fsp.writeFile(
      path.join(tempRoot, "src", "wasm-producer", "alpha.txt"),
      "alpha-0",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tempRoot, "src", "wasm-modules.manifest.json"),
      wasmManifest(["alpha"]),
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
        "src/wasm-modules.manifest.json",
        "--ts-manifest",
        "src/ts-modules.manifest.json",
        "--poll-ms",
        "120",
        "--refresh-throttle-ms",
        "400",
      ],
      { cwd: tempRoot, stdio: "pipe", env: process.env },
    );
    watcher.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
    watcher.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));
    const initialPid = watcher.pid;

    try {
      await waitForValue(
        async () => {
          try {
            return await fsp.readFile(
              path.join(tempRoot, "src", "wasm-contract", "alpha.wasm"),
              "utf8",
            );
          } catch {
            return "";
          }
        },
        (body) => body.includes("alpha-0"),
        20000,
        150,
      );

      await fsp.writeFile(
        path.join(tempRoot, "src", "wasm-producer", "beta.txt"),
        "beta-0",
        "utf8",
      );
      await fsp.writeFile(
        path.join(tempRoot, "src", "wasm-modules.manifest.json"),
        wasmManifest(["alpha", "beta"]),
        "utf8",
      );
      await waitForValue(
        async () => {
          try {
            return await fsp.readFile(
              path.join(tempRoot, "src", "wasm-contract", "beta.wasm"),
              "utf8",
            );
          } catch {
            return "";
          }
        },
        (body) => body.includes("beta-0"),
        25000,
        150,
      );

      await writeAndBumpMtime(path.join(tempRoot, "src", "wasm-producer", "beta.txt"), "beta-1");
      await waitForValue(
        async () =>
          await fsp.readFile(path.join(tempRoot, "src", "wasm-contract", "beta.wasm"), "utf8"),
        (body) => body.includes("beta-1"),
        25000,
        150,
      );

      await fsp.writeFile(
        path.join(tempRoot, "src", "wasm-modules.manifest.json"),
        wasmManifest(["beta"]),
        "utf8",
      );
      const merged = await waitForValue(
        async () => logs.join(""),
        (text) => text.includes("[wasm-watch] refresh:ok") && text.includes("removed=alpha"),
        20000,
        150,
      );
      assert.match(merged, /added=beta|added=-/);
      assert.equal(watcher.exitCode, null, "watcher exited during in-session refresh");
      assert.equal(watcher.pid, initialPid, "watcher process restarted unexpectedly");
      assertSingleQueueInvariant(merged);
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
