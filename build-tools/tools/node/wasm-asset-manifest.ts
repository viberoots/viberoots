#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function portableWasmAssetSourceIdentity(
  declared: string,
  resolved: string,
  sha256: string,
): string {
  if (resolved.startsWith("/nix/store/")) return resolved;
  if (declared.startsWith("//") || declared.startsWith(":")) {
    return `buck:${declared}#${sha256}`;
  }
  return `content:${sha256}`;
}

export function appendWasmAssetManifestEntry(
  declared: string,
  resolved: string,
  destination: string,
  blob: string,
  manifest: string,
): void {
  const bytes = fs.readFileSync(blob);
  const sha256 = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  const resolvedReal = fs.realpathSync(resolved);
  const producer = producerLineage(resolvedReal) || embeddedProducerLineage(blob);
  const value = JSON.parse(fs.readFileSync(manifest, "utf8"));
  value.assets.push({
    declaredSource: declared,
    resolvedSource: portableWasmAssetSourceIdentity(declared, resolvedReal, sha256),
    destination,
    sha256,
    ...(producer ? { producer } : {}),
  });
  fs.writeFileSync(manifest, `${JSON.stringify(value, null, 2)}\n`);
}

export function producerLineage(resolved: string): {
  storePath: string;
  outputIdentity: string;
  sourceRevision: string;
  compositionDigest?: string;
} | null {
  let cursor = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(cursor, "share/viberoots-rust/materialization-manifest.json");
    if (fs.existsSync(candidate)) {
      const manifest = JSON.parse(fs.readFileSync(candidate, "utf8"));
      const entry = manifest.storePaths?.find(
        (item: { path?: string }) =>
          typeof item.path === "string" && item.path.startsWith("/nix/store/"),
      );
      if (!entry) return null;
      return {
        storePath: entry.path,
        outputIdentity: entry.expectedOutputIdentity,
        sourceRevision: manifest.sourceRevision,
        ...(typeof manifest.compositionDigest === "string"
          ? { compositionDigest: manifest.compositionDigest }
          : {}),
      };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function embeddedProducerLineage(blob: string): ReturnType<typeof producerLineage> {
  if (!blob.endsWith(".js")) return null;
  const source = fs.readFileSync(blob, "utf8");
  const match = source.match(/^export const wasmProducer = (\{[^\n]+\}|null);$/m);
  if (!match || match[1] === "null") return null;
  const value = JSON.parse(match[1]!);
  if (
    typeof value.storePath !== "string" ||
    !value.storePath.startsWith("/nix/store/") ||
    typeof value.outputIdentity !== "string" ||
    typeof value.sourceRevision !== "string" ||
    (value.compositionDigest !== undefined && typeof value.compositionDigest !== "string")
  ) {
    throw new Error("inline WASM producer lineage is malformed");
  }
  return value;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  const args = process.argv.slice(2);
  if (args[0] === "--lineage") {
    if (!args[1]) throw new Error("--lineage requires a resolved producer path");
    process.stdout.write(`${JSON.stringify(producerLineage(fs.realpathSync(args[1])))}\n`);
    process.exit(0);
  }
  const [declared, resolved, destination, blob, manifest] = args;
  if (!declared || !resolved || !destination || !blob || !manifest) {
    throw new Error("wasm asset manifest requires declared, resolved, destination, blob, manifest");
  }
  appendWasmAssetManifestEntry(declared, resolved, destination, blob, manifest);
}
