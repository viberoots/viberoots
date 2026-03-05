#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { terminateChildTree } from "../lib/process-tree.ts";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function pickFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  server.close();
  if (!addr || typeof addr !== "object" || typeof addr.port !== "number") {
    throw new Error("failed to reserve an ephemeral port");
  }
  return addr.port;
}

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function startDevServer(appAbs: string, port: number): ChildProcess {
  return spawn("pnpm", ["run", "dev:ssr"], {
    cwd: appAbs,
    stdio: "pipe",
    env: {
      ...process.env,
      PORT: String(port),
      NODE_OPTIONS: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
}

async function waitForResponse(
  port: number,
  status: number,
  bodyMustInclude: string,
  timeoutMs = 45000,
): Promise<{ status: number; body: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(`http://127.0.0.1:${port}/`);
      if (res.status === status && res.body.includes(bodyMustInclude)) {
        return res;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error(`server did not return expected response within ${timeoutMs}ms`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  await terminateChildTree(child, 5000);
  try {
    if (child.exitCode == null) await Promise.race([once(child, "exit"), sleep(500)]);
  } catch {}
}

test(
  "Vite SSR dev runtime serves SSR and fails with deterministic contract errors",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("scaf-webapp-ssr-vite-dev-runtime", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
      await _$({
        cwd: appAbs,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --frozen-lockfile --ignore-workspace --reporter=append-only`;

      const entryServerPath = path.join(appAbs, "src", "entry-server.ts");
      const originalEntryServer = await fsp.readFile(entryServerPath, "utf8");

      {
        const port = await pickFreePort();
        const server = startDevServer(appAbs, port);
        try {
          const res = await waitForResponse(port, 200, 'data-ssr-marker="vite"');
          assert.match(res.body, /Hello from Vite SSR at \//);
          assert.ok(
            !res.body.includes('data-ssr-marker="vite-dev"'),
            "dev runtime must not fall back to static shell marker",
          );
        } finally {
          await stopServer(server);
        }
      }

      await fsp.rename(entryServerPath, `${entryServerPath}.missing`);
      try {
        const port = await pickFreePort();
        const server = startDevServer(appAbs, port);
        try {
          const res = await waitForResponse(
            port,
            500,
            "SSR contract error: failed to load /src/entry-server.ts:",
          );
          assert.match(res.body, /failed to load \/src\/entry-server\.ts:/);
        } finally {
          await stopServer(server);
        }
      } finally {
        await fsp.rename(`${entryServerPath}.missing`, entryServerPath);
      }

      await fsp.writeFile(entryServerPath, 'export const render = "not-a-function";\n', "utf8");
      try {
        const port = await pickFreePort();
        const server = startDevServer(appAbs, port);
        try {
          const res = await waitForResponse(
            port,
            500,
            "SSR contract error: /src/entry-server.ts must export a render(url) function",
          );
          assert.equal(
            res.body.trim(),
            "SSR contract error: /src/entry-server.ts must export a render(url) function",
          );
        } finally {
          await stopServer(server);
        }
      } finally {
        await fsp.writeFile(entryServerPath, originalEntryServer, "utf8");
      }
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
