#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

export const STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA = "static-webapp-artifact-bundle@1";
export const STATIC_WEBAPP_ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
export const STATIC_WEBAPP_ARTIFACT_MAX_FILES = 10_000;

export type StaticWebappArtifactBundleFile = {
  path: string;
  mode: "file" | "executable";
  contentBase64: string;
};

export type StaticWebappArtifactBundle = {
  schemaVersion: typeof STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA;
  files: StaticWebappArtifactBundleFile[];
};

export type StaticWebappArtifactDirFile = {
  rel: string;
  abs: string;
  executable: boolean;
  size: number;
};

function assertSafeRelativePath(rel: string): void {
  if (!rel || path.isAbsolute(rel) || rel.includes("\0")) {
    throw new Error(`static-webapp artifact contains unsafe path: ${rel}`);
  }
  if (rel.split(/[\\/]/).some((segment) => segment === ".." || segment === "")) {
    throw new Error(`static-webapp artifact contains unsafe path: ${rel}`);
  }
}

async function scanDir(root: string, dir: string, files: StaticWebappArtifactDirFile[]) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    assertSafeRelativePath(rel);
    if (entry.isSymbolicLink()) {
      throw new Error(`static-webapp artifact may not contain symlinks: ${rel}`);
    }
    if (entry.isDirectory()) {
      await scanDir(root, abs, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`static-webapp artifact contains unsupported entry: ${rel}`);
    }
    const stat = await fsp.stat(abs);
    files.push({
      rel,
      abs,
      executable: (stat.mode & 0o111) !== 0,
      size: stat.size,
    });
  }
}

export async function inspectStaticWebappArtifactDir(
  artifactDir: string,
): Promise<StaticWebappArtifactDirFile[]> {
  const root = path.resolve(artifactDir);
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new Error(`static-webapp artifact is not a directory: ${root}`);
  const files: StaticWebappArtifactDirFile[] = [];
  await scanDir(root, root, files);
  if (files.length > STATIC_WEBAPP_ARTIFACT_MAX_FILES) {
    throw new Error(`static-webapp artifact has too many files: ${files.length}`);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > STATIC_WEBAPP_ARTIFACT_MAX_BYTES) {
    throw new Error(`static-webapp artifact exceeds size limit: ${totalBytes}`);
  }
  return files;
}

export async function createStaticWebappArtifactBundle(
  artifactDir: string,
): Promise<StaticWebappArtifactBundle> {
  const files = await inspectStaticWebappArtifactDir(artifactDir);
  return {
    schemaVersion: STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA,
    files: await Promise.all(
      files.map(async (file) => ({
        path: file.rel,
        mode: file.executable ? ("executable" as const) : ("file" as const),
        contentBase64: (await fsp.readFile(file.abs)).toString("base64"),
      })),
    ),
  };
}

export async function createStaticWebappArtifactBundleBytes(artifactDir: string): Promise<Buffer> {
  return Buffer.from(JSON.stringify(await createStaticWebappArtifactBundle(artifactDir)) + "\n");
}

export function digestStaticWebappArtifactBundleBytes(bytes: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function parseStaticWebappArtifactBundle(bytes: Buffer): StaticWebappArtifactBundle {
  if (bytes.byteLength > STATIC_WEBAPP_ARTIFACT_MAX_BYTES) {
    throw new Error(`static-webapp artifact upload exceeds size limit: ${bytes.byteLength}`);
  }
  const parsed = JSON.parse(bytes.toString("utf8")) as StaticWebappArtifactBundle;
  if (parsed.schemaVersion !== STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA) {
    throw new Error(`unsupported static-webapp artifact bundle: ${parsed.schemaVersion}`);
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("static-webapp artifact bundle must include files");
  }
  if (parsed.files.length > STATIC_WEBAPP_ARTIFACT_MAX_FILES) {
    throw new Error(`static-webapp artifact has too many files: ${parsed.files.length}`);
  }
  let totalBytes = 0;
  const seenPaths = new Set<string>();
  for (const file of parsed.files) {
    assertSafeRelativePath(file.path);
    if (seenPaths.has(file.path)) {
      throw new Error(`static-webapp artifact contains duplicate path: ${file.path}`);
    }
    seenPaths.add(file.path);
    if (file.mode !== "file" && file.mode !== "executable") {
      throw new Error(`static-webapp artifact has invalid mode for ${file.path}`);
    }
    totalBytes += Buffer.byteLength(file.contentBase64, "base64");
  }
  if (totalBytes > STATIC_WEBAPP_ARTIFACT_MAX_BYTES) {
    throw new Error(`static-webapp artifact exceeds size limit: ${totalBytes}`);
  }
  return parsed;
}

export async function materializeStaticWebappArtifactBundle(
  bytes: Buffer,
  outputDir: string,
): Promise<void> {
  const bundle = parseStaticWebappArtifactBundle(bytes);
  await fsp.rm(outputDir, { recursive: true, force: true });
  for (const file of bundle.files) {
    const abs = path.join(outputDir, file.path);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, Buffer.from(file.contentBase64, "base64"), {
      mode: file.mode === "executable" ? 0o755 : 0o644,
    });
  }
}
