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
  logs: string[],
  server: ChildProcess,
  timeoutMs = 120000,
): Promise<{ status: number; body: string }> {
  const start = Date.now();
  let lastResponse: { status: number; body: string } | null = null;
  while (Date.now() - start < timeoutMs) {
    if (server.exitCode != null) {
      const logTail = logs.join("").slice(-12000);
      throw new Error(
        [
          `dev server exited before expected response (code=${server.exitCode})`,
          `expected status=${status} body fragment=${bodyMustInclude}`,
          `logs tail:\n${logTail}`,
        ].join("\n\n"),
      );
    }
    try {
      const res = await httpGet(`http://127.0.0.1:${port}/`);
      lastResponse = res;
      if (res.status === status && res.body.includes(bodyMustInclude)) {
        return res;
      }
    } catch {}
    await sleep(500);
  }
  const logTail = logs.join("").slice(-12000);
  const lastStatus = lastResponse?.status ?? 0;
  const lastBodyTail = (lastResponse?.body || "").slice(-2000);
  throw new Error(
    [
      `server did not return expected response within ${timeoutMs}ms`,
      `expected status=${status} body fragment=${bodyMustInclude}`,
      `last response status=${lastStatus} body tail:\n${lastBodyTail}`,
      `logs tail:\n${logTail}`,
    ].join("\n\n"),
  );
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
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests --skip-lockfile-gen`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
      await _$({
        cwd: appAbs,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --prefer-offline --ignore-workspace --reporter=append-only`;

      const entryServerPath = path.join(appAbs, "src", "entry-server.ts");
      const originalEntryServer = await fsp.readFile(entryServerPath, "utf8");

      {
        const port = await pickFreePort();
        const server = startDevServer(appAbs, port);
        const logs: string[] = [];
        server.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
        server.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));
        try {
          const res = await waitForResponse(port, 200, 'data-ssr-marker="vite"', logs, server);
          assert.match(res.body, /Vite SSR \+ React Native Web/);
          assert.match(res.body, /Welcome to demo-vite-ssr/);
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
        const logs: string[] = [];
        server.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
        server.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));
        try {
          const res = await waitForResponse(
            port,
            500,
            "SSR contract error: failed to load /src/entry-server.ts:",
            logs,
            server,
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
        const logs: string[] = [];
        server.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
        server.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));
        try {
          const res = await waitForResponse(
            port,
            500,
            "SSR contract error: /src/entry-server.ts must export a render(url) function",
            logs,
            server,
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
