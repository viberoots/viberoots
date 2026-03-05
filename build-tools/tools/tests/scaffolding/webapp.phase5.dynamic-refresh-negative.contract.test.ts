#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { stopServer } from "./lib/webapp-static-hmr";
import { waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "PR-8 dynamic refresh negative path emits stable failure markers without refresh hot-loop",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const repoRoot = process.cwd();
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-phase5-refresh-neg-"));
    await fsp.mkdir(path.join(tempRoot, "src", "wasm-producer"), { recursive: true });
    await fsp.mkdir(path.join(tempRoot, "src", "wasm-contract"), { recursive: true });
    await fsp.mkdir(path.join(tempRoot, "src", "ts-modules"), { recursive: true });
    await fsp.writeFile(
      path.join(tempRoot, "src", "wasm-producer", "alpha.txt"),
      "alpha-ok",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tempRoot, "src", "ts-modules", "client.ts"),
      "export const v = 1;\n",
    );
    await fsp.writeFile(
      path.join(tempRoot, "src", "wasm-modules.manifest.json"),
      JSON.stringify(
        {
          defaultModuleKey: "alpha",
          modules: [
            {
              moduleKey: "alpha",
              sourcePath: "src/wasm-contract/alpha.wasm",
              runtimeDestinations: { client: "wasm/alpha.wasm", server: "server/wasm/alpha.wasm" },
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tempRoot, "src", "ts-modules.manifest.json"),
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
        (body) => body.includes("alpha-ok"),
        20000,
        150,
      );

      await fsp.writeFile(
        path.join(tempRoot, "src", "ts-modules.manifest.json"),
        JSON.stringify(
          {
            defaultModuleKey: "client",
            modules: [
              {
                moduleKey: "client",
                sourceEntryPath: "src/ts-modules/missing.ts",
                runtimeImportPath: "./ts-modules/missing",
              },
            ],
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const mergedAfterFail = await waitForValue(
        async () => logs.join(""),
        (text) =>
          text.includes("[wasm-watch] refresh:fail reason=contracts-or-surface-change") &&
          text.includes("[wasm-watch] refresh:recovery:"),
        20000,
        150,
      );
      const refreshStartCount = (mergedAfterFail.match(/\[wasm-watch\] refresh:start/g) || [])
        .length;
      assert.ok(
        refreshStartCount <= 3,
        `refresh cadence is unbounded (refresh:start count=${refreshStartCount})`,
      );

      await writeAndBumpMtime(
        path.join(tempRoot, "src", "wasm-producer", "alpha.txt"),
        "alpha-after-fail",
      );
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
