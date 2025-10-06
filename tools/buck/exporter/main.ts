#!/usr/bin/env zx-wrapper
import { cacheHits, cacheMisses, runGoList } from "./golist.ts";
import { attrList, cqueryNodes, parseArgs, readSimulatedNodes, writeIfChangedJSON } from "./io.ts";
import { loadPresentAdapters } from "./lang/contract.ts";
import type { Adapter, Batch, Metrics, Node } from "./types.ts";

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

  // Drop internal Buck/config cells that are not part of the repo's targets
  nodes = nodes.filter((n) => {
    const nm = n.name || "";
    return !(nm.startsWith("config//") || nm.startsWith("prelude//"));
  });

  // Early-fail validation for PR 2: ensure authoritative classification for Go
  // If a node appears Go-like via srcs but lacks both rule_type starting with go_ and a lang:go label, fail.
  const bad: string[] = [];
  for (const n of nodes) {
    const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
    const looksGo = srcs.some((s) => s.endsWith(".go"));
    const hasGoRT = (n.rule_type || "").startsWith("go_");
    const hasLangGo = (n.labels || []).includes("lang:go");
    if (looksGo && !hasGoRT && !hasLangGo) {
      bad.push(n.name);
    }
  }
  if (bad.length) {
    const sample = bad.slice(0, 10).join("\n  - ");
    throw new Error(
      [
        "Authoritative exporter requires rule_type or macro-stamped labels for Go targets.",
        "These targets include .go sources but lack both rule_type starting with 'go_' and 'lang:go' label:",
        `  - ${sample}`,
        bad.length > 10 ? `  ... and ${bad.length - 10} more` : "",
        "Fix: ensure your Buck macros stamp 'lang:go' (and 'kind:bin' for binaries) or Buck emits rule_type.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const adapters: Adapter[] = await loadPresentAdapters();
  const active = adapters
    .filter((a) => nodes.some((n) => a.isNode(n)))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Fast path if no known-language nodes
  if (active.length === 0) {
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

  const gMetrics: Metrics = {
    totalBatches: 0,
    cacheHits: 0,
    cacheMisses: 0,
    durationMs: 0,
    tupleKeys: [],
  };
  const startedAt = Date.now();

  // Start with original nodes; maintain a name→node map to merge labels per adapter
  const byName = new Map<string, Node>(
    nodes
      .map((n) => ({ ...n, labels: Array.from(new Set(n.labels || [])).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => [n.name, n] as const),
  );

  for (const adapter of active) {
    const nodesA = nodes
      .filter((n) => adapter.isNode(n))
      .sort((a, b) => a.name.localeCompare(b.name));
    const batchesA = await adapter.buildBatches(nodesA);

    // If batches carry Go tuples, execute go list to warm cache for labeler
    if (batchesA.length > 0 && (batchesA[0] as any).tuple) {
      const goListResults: Array<{ batch: Batch; pkgs: any[] }> = [];
      let i = 0;
      const workers = new Array(Math.max(1, Math.min(maxParallel, batchesA.length)))
        .fill(0)
        .map(async () => {
          while (i < batchesA.length) {
            const idx = i++;
            const b = batchesA[idx];
            const pkgs = await runGoList(
              (b as any).tuple,
              (b as any).roots,
              (b as any).cwd,
              cacheDir,
            );
            goListResults.push({ batch: b, pkgs });
          }
        });
      await Promise.all(workers);
      const cache = new Map<Batch, any>();
      for (const r of goListResults) cache.set(r.batch, r.pkgs);
      (global as any).__GO_LIST_CACHE = { get: (b: Batch) => cache.get(b) };

      // Update metrics
      gMetrics.totalBatches += batchesA.length;
      gMetrics.tupleKeys = Array.from(
        new Set([
          ...gMetrics.tupleKeys,
          ...batchesA.map(
            (b: any) =>
              `${b.tuple.goos}|${b.tuple.goarch}|${b.tuple.cgo}|${b.tuple.tagsKey}|${b.tuple.goflagsKey}|${b.tuple.toolchain}`,
          ),
        ]),
      ).sort();
    }

    const enriched = await adapter.attachLabels(
      Array.from(byName.values()),
      batchesA as any,
      cacheDir,
    );
    for (const n of enriched) {
      const cur = byName.get(n.name) || n;
      const labs = new Set([...(cur.labels || []), ...((n.labels as any) || [])]);
      byName.set(n.name, { ...cur, labels: Array.from(labs).sort() });
    }
  }

  const normalized = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  gMetrics.durationMs = Date.now() - startedAt;
  gMetrics.cacheHits = cacheHits;
  gMetrics.cacheMisses = cacheMisses;
  await writeIfChangedJSON(out, normalized);
  if (metricsOut) await emitMetrics(metricsOut, gMetrics);
}

type GoPkgPerBatch = { batch: Batch; pkgs: any[] };

async function emitMetrics(path: string, m: Metrics) {
  await (await import("fs-extra")).outputFile(path, JSON.stringify(m, null, 2) + "\n", "utf8");
}
