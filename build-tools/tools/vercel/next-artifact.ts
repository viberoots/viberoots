#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFlagStr } from "../lib/cli.ts";

export const VERCEL_NEXT_ARTIFACT_SCHEMA = "vercel-next-artifact@1";
export const VERCEL_NEXT_IDENTITY_SCHEMA = "vercel-next-artifact-identity@1";

type VercelNextArtifactConfig = {
  schemaVersion: typeof VERCEL_NEXT_ARTIFACT_SCHEMA;
  projectName: string;
  framework: "nextjs";
  runtime: {
    nodeVersion: "20.x" | "22.x";
    buildEnv?: string[];
    runtimeEnv?: string[];
  };
};

type VercelFile = {
  rel: string;
  abs: string;
  executable: boolean;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertSafeRel(rel: string): void {
  if (!rel || path.isAbsolute(rel) || rel.includes("\0")) {
    throw new Error(`vercel artifact contains unsafe path: ${rel}`);
  }
  if (rel.split(/[\\/]/).some((segment) => segment === "" || segment === "..")) {
    throw new Error(`vercel artifact contains unsafe path: ${rel}`);
  }
}

async function copyTree(src: string, dest: string): Promise<void> {
  if (!(await exists(src))) return;
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`vercel artifact input may not contain symlinks: ${srcPath}`);
    }
    if (!entry.isFile()) continue;
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await fsp.copyFile(srcPath, destPath);
  }
}

async function scanFiles(root: string, dir: string, out: VercelFile[]): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    assertSafeRel(rel);
    if (entry.isDirectory()) {
      await scanFiles(root, abs, out);
      continue;
    }
    if (entry.isSymbolicLink()) throw new Error(`vercel artifact may not contain symlinks: ${rel}`);
    if (!entry.isFile()) throw new Error(`vercel artifact contains unsupported entry: ${rel}`);
    const stat = await fsp.stat(abs);
    if (stat.nlink > 1) throw new Error(`vercel artifact may not contain hardlinks: ${rel}`);
    out.push({ rel, abs, executable: (stat.mode & 0o111) !== 0 });
  }
}

async function loadConfig(configPath: string): Promise<VercelNextArtifactConfig> {
  const parsed = JSON.parse(await fsp.readFile(configPath, "utf8")) as VercelNextArtifactConfig;
  if (parsed.schemaVersion !== VERCEL_NEXT_ARTIFACT_SCHEMA) {
    throw new Error(`unsupported Vercel artifact config schema: ${parsed.schemaVersion}`);
  }
  if (!parsed.projectName || parsed.framework !== "nextjs") {
    throw new Error("Vercel artifact config must declare projectName and framework=nextjs");
  }
  if (parsed.runtime?.nodeVersion !== "20.x" && parsed.runtime?.nodeVersion !== "22.x") {
    throw new Error("Vercel artifact config must declare runtime.nodeVersion as 20.x or 22.x");
  }
  for (const name of [...(parsed.runtime.buildEnv || []), ...(parsed.runtime.runtimeEnv || [])]) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new Error(`Vercel artifact config has invalid env name: ${name}`);
    }
  }
  return parsed;
}

async function assertInputsDeclared(
  appDir: string,
  config: VercelNextArtifactConfig,
): Promise<void> {
  if (await exists(path.join(appDir, ".vercel"))) {
    throw new Error("ambient .vercel state is not allowed; declare Vercel metadata in config");
  }
  const declared = new Set([
    ...(config.runtime.buildEnv || []),
    ...(config.runtime.runtimeEnv || []),
  ]);
  const ambient = Object.keys(process.env)
    .filter((name) => name === "VERCEL" || name.startsWith("VERCEL_"))
    .filter((name) => !declared.has(name));
  if (ambient.length > 0) {
    throw new Error(
      `undeclared Vercel environment variables are not allowed: ${ambient.sort().join(", ")}`,
    );
  }
}

export async function artifactIdentityForVercelNextOutput(outputDir: string): Promise<string> {
  const root = path.resolve(outputDir);
  const files: VercelFile[] = [];
  await scanFiles(root, root, files);
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(`${file.rel}\n`);
    hash.update(file.executable ? "executable\n" : "file\n");
    hash.update(await fsp.readFile(file.abs));
    hash.update("\n");
  }
  return `vercel-next:${hash.digest("hex")}`;
}

function runtimeName(nodeVersion: "20.x" | "22.x"): string {
  return nodeVersion === "20.x" ? "nodejs20.x" : "nodejs22.x";
}

export async function createVercelNextArtifact(opts: {
  appDir: string;
  distDir: string;
  configPath: string;
  outputDir: string;
  identityPath: string;
}): Promise<string> {
  const appDir = path.resolve(opts.appDir);
  const distDir = path.resolve(opts.distDir);
  const outputDir = path.resolve(opts.outputDir);
  const config = await loadConfig(path.resolve(opts.configPath));
  await assertInputsDeclared(appDir, config);
  await fsp.access(path.join(distDir, "server", "index.js"));
  await fsp.access(path.join(distDir, "client", ".next"));
  await fsp.rm(outputDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(outputDir, "functions", "render.func"), { recursive: true });
  await fsp.writeFile(
    path.join(outputDir, "config.json"),
    JSON.stringify(
      { version: 3, routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/render.func" }] },
      null,
      2,
    ) + "\n",
  );
  await fsp.writeFile(
    path.join(outputDir, "functions", "render.func", ".vc-config.json"),
    JSON.stringify(
      {
        runtime: runtimeName(config.runtime.nodeVersion),
        handler: "server/index.js",
        launcherType: "Nodejs",
      },
      null,
      2,
    ) + "\n",
  );
  await copyTree(
    path.join(distDir, "server"),
    path.join(outputDir, "functions", "render.func", "server"),
  );
  await copyTree(
    path.join(distDir, "client"),
    path.join(outputDir, "functions", "render.func", "client"),
  );
  await copyTree(path.join(distDir, "client", "public"), path.join(outputDir, "static"));
  await copyTree(
    path.join(distDir, "client", ".next", "static"),
    path.join(outputDir, "static", "_next", "static"),
  );
  await fsp.writeFile(
    path.join(outputDir, "bucknix.json"),
    JSON.stringify(
      {
        schemaVersion: VERCEL_NEXT_ARTIFACT_SCHEMA,
        projectName: config.projectName,
        framework: config.framework,
        runtime: config.runtime,
        source: "bucknix-node-webapp-dist",
      },
      null,
      2,
    ) + "\n",
  );
  const identity = await artifactIdentityForVercelNextOutput(outputDir);
  await fsp.mkdir(path.dirname(path.resolve(opts.identityPath)), { recursive: true });
  await fsp.writeFile(
    path.resolve(opts.identityPath),
    JSON.stringify(
      { schemaVersion: VERCEL_NEXT_IDENTITY_SCHEMA, kind: "vercel-next", identity },
      null,
      2,
    ) + "\n",
  );
  return identity;
}

async function main(): Promise<void> {
  const requiredFlag = (name: string): string => {
    const value = getFlagStr(name).trim();
    if (!value) throw new Error(`missing --${name}`);
    return value;
  };
  await createVercelNextArtifact({
    appDir: requiredFlag("app-dir"),
    distDir: requiredFlag("dist-dir"),
    configPath: requiredFlag("config"),
    outputDir: requiredFlag("out"),
    identityPath: requiredFlag("identity-out"),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
