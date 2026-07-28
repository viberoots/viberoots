import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

export async function verifyBrowserPackageInPinnedEngine(
  output: string,
  tmp: string,
): Promise<void> {
  const pkg = path.join(output, "pkg");
  const manifest = JSON.parse(
    await fs.readFile(path.join(output, "share/viberoots-rust/wasm-manifest.json"), "utf8"),
  );
  const executable = String(manifest.tools?.browserExecutable || "");
  assert.match(
    executable,
    /^\/nix\/store\/.+\/(?:bin\/firefox|Applications\/Firefox\.app\/Contents\/MacOS\/firefox)$/,
  );

  let resolveReport!: (value: unknown) => void;
  let rejectReport!: (reason: unknown) => void;
  const report = new Promise<unknown>((resolve, reject) => {
    resolveReport = resolve;
    rejectReport = reject;
  });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/report") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        resolveReport(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(204).end();
        return;
      }
      const rel = url.pathname === "/" ? "browser-harness.html" : url.pathname.slice(1);
      const file = path.resolve(pkg, rel);
      if (!file.startsWith(`${path.resolve(pkg)}${path.sep}`)) throw new Error("invalid path");
      const body = await fs.readFile(file);
      const contentType = rel.endsWith(".wasm")
        ? "application/wasm"
        : rel.endsWith(".js")
          ? "text/javascript"
          : "text/html";
      response.writeHead(200, { "content-type": contentType }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const profile = path.join(tmp, "firefox-rust-wasm-profile");
  await fs.mkdir(profile, { recursive: true });
  const url =
    `http://127.0.0.1:${address.port}/browser-harness.html` +
    "?viberootsProbe=answer&viberootsReport=%2Freport";
  const browser = spawn(executable, ["--headless", "--no-remote", "--profile", profile, url], {
    stdio: "pipe",
  });
  browser.once("error", rejectReport);
  browser.once("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      rejectReport(new Error(`browser exited before reporting: code=${code} signal=${signal}`));
    }
  });
  const timeout = setTimeout(() => rejectReport(new Error("browser WASM probe timed out")), 30_000);
  try {
    assert.deepEqual(await report, { probe: "answer", result: 42 });
  } finally {
    clearTimeout(timeout);
    browser.kill("SIGTERM");
    server.close();
  }
}
