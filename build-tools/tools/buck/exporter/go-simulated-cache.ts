#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { recordCacheHit, recordCacheMiss } from "./golist.ts";
import type { Batch } from "./types.ts";

export async function readOrBuildSimulatedBatchCache(
  batch: Batch,
  cacheDir: string,
  resolveNodeSourcePath: (targetName: string, src: string) => string,
  buildLabels: () => Promise<Map<string, string[]>>,
): Promise<Map<string, string[]>> {
  await fsp.mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(
    cacheDir,
    `${await cacheKeyForBatch(batch, resolveNodeSourcePath)}.json`,
  );
  try {
    const raw = await fsp.readFile(cachePath, "utf8");
    recordCacheHit();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string[]>));
  } catch {}
  const built = await buildLabels();
  await fsp.writeFile(
    cachePath,
    JSON.stringify(Object.fromEntries(built.entries()), null, 2) + "\n",
    "utf8",
  );
  recordCacheMiss();
  return built;
}

async function cacheKeyForBatch(
  batch: Batch,
  resolveNodeSourcePath: (targetName: string, src: string) => string,
): Promise<string> {
  const srcHashes = await Promise.all(
    batch.members.flatMap((node) =>
      (Array.isArray(node.srcs) ? node.srcs : [])
        .filter((src) => src.endsWith(".go"))
        .map(
          async (src) =>
            `${node.name}:${src}:${await sha256(resolveNodeSourcePath(node.name, src))}`,
        ),
    ),
  );
  const payload = {
    cwd: batch.cwd,
    tuple: batch.tuple,
    roots: [...batch.roots].sort(),
    goModHash: await sha256(path.join(process.cwd(), batch.cwd, "go.mod")),
    srcHashes: srcHashes.sort(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function sha256(filePath: string): Promise<string> {
  const raw = await fsp.readFile(filePath).catch(() => Buffer.from(""));
  return crypto.createHash("sha256").update(raw).digest("hex");
}
