#!/usr/bin/env zx-wrapper
import { buildBatches, isGoNode } from "./batch";
import { cacheHits, cacheMisses, runGoList } from "./golist";
import { attrList, cqueryNodes, parseArgs, readSimulatedNodes, writeIfChangedJSON } from "./io";
import { attachGoModuleLabels } from "./labeler";
import type { Batch, Metrics, Node } from "./types";

function sortAndDedupeLabels(nodes: Node[]): Node[] {
  return nodes
    .map((n) => ({
      ...n,
      labels: Array.from(new Set(n.labels || [])).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function run() {
  const { out, scope, simulate, maxParallel, cacheDir, metricsOut } = parseArgs(
    (global as any).argv,
  );
  let nodes: Node[];
  if (simulate) nodes = await readSimulatedNodes(simulate);
  else nodes = await cqueryNodes(scope, attrList);

  // Fast path if no go nodes
  if (!nodes.some((n) => isGoNode(n))) {
    const normalized = nodes.map((n) => ({ ...n, labels: Array.from(new Set(n.labels || [])) }));
    await writeIfChangedJSON(out, normalized);
    if (metricsOut)
      await emitMetrics(metricsOut, {
        totalBatches: 0,
        cacheHits: 0,
        cacheMisses: 0,
        durationMs: 0,
        tupleKeys: [],
      });
    return;
  }

  const batches = await buildBatches(nodes);
  const gMetrics: Metrics = {
    totalBatches: batches.length,
    cacheHits: 0,
    cacheMisses: 0,
    durationMs: 0,
    tupleKeys: [],
  };
  const startedAt = Date.now();

  // Execute go list per batch with limited concurrency
  const goListResults: GoPkgPerBatch[] = [];
  let i = 0;
  const workers = new Array(Math.max(1, Math.min(maxParallel, batches.length)))
    .fill(0)
    .map(async () => {
      while (i < batches.length) {
        const idx = i++;
        const b = batches[idx];
        const pkgs = await runGoList(b.tuple, b.roots, b.cwd, cacheDir);
        goListResults.push({ batch: b, pkgs });
      }
    });
  await Promise.all(workers);

  // Provide pkgs to labeler via a simple shared map on global to avoid coupling
  const cache = new Map<Batch, any>();
  for (const r of goListResults) cache.set(r.batch, r.pkgs);
  (global as any).__GO_LIST_CACHE = { get: (b: Batch) => cache.get(b) };

  const enriched = await attachGoModuleLabels(nodes, batches, cacheDir);
  const normalized = sortAndDedupeLabels(enriched);
  gMetrics.durationMs = Date.now() - startedAt;
  gMetrics.cacheHits = cacheHits;
  gMetrics.cacheMisses = cacheMisses;
  gMetrics.tupleKeys = Array.from(
    new Set(
      batches.map(
        (b) =>
          `${b.tuple.goos}|${b.tuple.goarch}|${b.tuple.cgo}|${b.tuple.tagsKey}|${b.tuple.goflagsKey}|${b.tuple.toolchain}`,
      ),
    ),
  ).sort();

  await writeIfChangedJSON(out, normalized);
  if (metricsOut) await emitMetrics(metricsOut, gMetrics);
}

type GoPkgPerBatch = { batch: Batch; pkgs: any[] };

async function emitMetrics(path: string, m: Metrics) {
  await (await import("fs-extra")).outputFile(path, JSON.stringify(m, null, 2) + "\n", "utf8");
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
