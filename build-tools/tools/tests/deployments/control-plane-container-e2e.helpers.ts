#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { findContainerRuntime } from "./control-plane-container-smoke.helpers";

const execFileAsync = promisify(execFile);
type Runtime = NonNullable<Awaited<ReturnType<typeof findContainerRuntime>>>;

export const E2E_TOKEN = "container-e2e-token";
export const POSTGRES_IMAGE = "postgres:16-alpine";

export async function createNetwork(runtime: Runtime, name: string) {
  await execFileAsync(runtime.bin, [...runtime.args, "network", "create", name], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

export async function removeNetwork(runtime: Runtime, name: string) {
  await execFileAsync(runtime.bin, [...runtime.args, "network", "rm", name], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  }).catch(() => {});
}

export async function ensurePostgresImage(runtime: Runtime): Promise<string | null> {
  const present = await execFileAsync(
    runtime.bin,
    [...runtime.args, "image", "inspect", POSTGRES_IMAGE],
    { timeout: 15_000 },
  ).then(
    () => true,
    () => false,
  );
  if (present) return null;
  const pulled = await execFileAsync(runtime.bin, [...runtime.args, "pull", POSTGRES_IMAGE], {
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  }).then(
    () => true,
    (error) => String(error?.stderr || error?.message || error),
  );
  return pulled === true ? null : `unable to pull ${POSTGRES_IMAGE}: ${pulled}`;
}

export async function runFixtureContainer(opts: {
  runtime: Runtime;
  name: string;
  image: string;
  network: string;
  command?: string[];
  env?: Record<string, string>;
  mounts?: string[];
  entrypoint?: string;
  publish?: string;
}) {
  const args = [
    ...opts.runtime.args,
    "run",
    "--rm",
    "-d",
    "--name",
    opts.name,
    "--network",
    opts.network,
    ...(opts.entrypoint ? ["--entrypoint", opts.entrypoint] : []),
    ...(opts.publish ? ["-p", opts.publish] : []),
    ...Object.entries(opts.env || {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...(opts.mounts || []).flatMap((mount) => ["--mount", mount]),
    opts.image,
    ...(opts.command || []),
  ];
  await execFileAsync(opts.runtime.bin, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
}

export async function writeFakeS3Server(file: string) {
  await fsp.writeFile(
    file,
    `
import http from "node:http";
const objects = new Map();
http.createServer(async (req, res) => {
  if ((req.url || "") === "/__test__/corrupt-all") {
    for (const [key, object] of objects.entries()) {
      objects.set(key, { ...object, body: Buffer.from("corrupted container e2e object") });
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ count: objects.size }));
    return;
  }
  const key = decodeURIComponent((req.url || "/").split("/").slice(2).join("/"));
  if (req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    objects.set(key, { body: Buffer.concat(chunks), headers: req.headers });
    res.writeHead(200).end();
  } else if (req.method === "GET" && objects.has(key)) {
    res.writeHead(200, objects.get(key).headers).end(objects.get(key).body);
  } else if (req.method === "HEAD" && objects.has(key)) {
    res.writeHead(200, objects.get(key).headers).end();
  } else {
    res.writeHead(404).end("missing");
  }
}).listen(9000, "0.0.0.0");
`,
  );
}

export async function corruptFakeS3Objects(runtime: Runtime, container: string) {
  await execFileAsync(
    runtime.bin,
    [
      ...runtime.args,
      "exec",
      container,
      "node",
      "-e",
      "const r = await fetch('http://127.0.0.1:9000/__test__/corrupt-all'); if (!r.ok) throw new Error(await r.text()); console.log(await r.text());",
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
}

export async function waitForServiceReady(port: number, token: string) {
  const deadline = Date.now() + 60_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
        headers: { authorization: `Bearer ${token}` },
      });
      last = `${response.status} ${await response.text()}`;
      if (response.ok) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`control-plane service did not become ready: ${last}`);
}

export async function queryPostgresJson(runtime: Runtime, container: string, sql: string) {
  const { stdout } = await execFileAsync(
    runtime.bin,
    [
      ...runtime.args,
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-tA",
      "-c",
      sql,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout.trim() || "null");
}

export async function writeWorkspace(root: string) {
  const workspace = path.join(root, "workspace");
  const deployDir = path.join(workspace, "projects/deployments/cloud-control-fixture/staging-s3");
  const artifactDir = path.join(workspace, "artifact");
  const binDir = path.join(workspace, "bin");
  await fsp.mkdir(deployDir, { recursive: true });
  await fsp.mkdir(artifactDir, { recursive: true });
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(path.join(workspace, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fsp.writeFile(path.join(artifactDir, "index.html"), "<html>container-e2e</html>\n");
  await fsp.writeFile(
    path.join(deployDir, "aws-s3-sync.jsonc"),
    '{\n  "distribution": "container-e2e.example.test"\n}\n',
  );
  await writeFakeAws(path.join(binDir, "aws"));
  return { workspace, artifactDir: "/workspace/artifact" };
}

async function writeFakeAws(scriptPath: string) {
  await fsp.writeFile(
    scriptPath,
    [
      "#!/usr/bin/env node",
      'import fs from "node:fs";',
      'import path from "node:path";',
      "const args = process.argv.slice(2);",
      "const artifactDir = path.resolve(args[2]);",
      'const bucket = String(args[3] || "").replace(/^s3:\\/\\//, "");',
      'const root = process.env.VBR_S3_STATIC_FAKE_PUBLISH_ROOT || "";',
      'const log = process.env.VBR_S3_STATIC_FAKE_AWS_LOG || "";',
      'const config = JSON.parse(fs.readFileSync(process.env.VBR_S3_STATIC_RENDERED_CONFIG, "utf8"));',
      'if (args[0] !== "s3" || args[1] !== "sync" || config.bucket !== bucket || !root) process.exit(4);',
      "const dest = path.join(root, bucket);",
      "fs.rmSync(dest, { recursive: true, force: true });",
      "fs.mkdirSync(path.dirname(dest), { recursive: true });",
      "fs.cpSync(artifactDir, dest, { recursive: true });",
      'if (log) fs.appendFileSync(log, JSON.stringify({ args, artifactDir, bucket }) + "\\n");',
      'console.log(JSON.stringify({ syncId: "container-e2e-sync", bucket }));',
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
}
