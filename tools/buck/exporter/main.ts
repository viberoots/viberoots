#!/usr/bin/env zx-wrapper
import {
  dirsForTarget,
  findModuleRootForDirs,
  isGoNode,
  packageDirFromTargetName,
} from "./batch.ts";
import { deriveTupleForNode } from "./env.ts";
import { cacheHits, cacheMisses, runGoList } from "./golist.ts";
import { cqueryNodes } from "./cquery/index.ts";
import { attrList } from "./cquery/attrs.ts";
import { parseArgs, readSimulatedNodes, writeIfChangedJSON } from "./io.ts";
import { loadPresentAdapters } from "./lang/contract.ts";
import type { Adapter, Batch, GoListByBatch, Metrics, Node } from "./types.ts";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { collectFindings, determineMode, emitFindings, logValidationMode } from "./validation.ts";

export async function run() {
  const { out, scope, simulate, maxParallel, cacheDir, metricsOut, validation } = parseArgs(
    (global as any).argv,
  );
  const verbose = (() => {
    const v = String(process.env.EXPORTER_VERBOSE || "")
      .trim()
      .toLowerCase();
    return v === "1" || v === "true";
  })();
  const argvObj: Record<string, any> = ((global as any).argv || {}) as any;
  const cliValidation = typeof argvObj?.validation === "string" ? String(argvObj.validation) : "";
  const envValidation = String(process.env.EXPORTER_VALIDATION || "");
  let nodes: Node[];
  if (simulate) nodes = await readSimulatedNodes(simulate);
  else nodes = await cqueryNodes(scope, attrList);

  // Drop internal Buck/config cells that are not part of the repo's targets
  nodes = nodes.filter((n) => {
    const nm = n.name || "";
    return !(nm.startsWith("config//") || nm.startsWith("prelude//"));
  });

  // Adapter-level validation hook (PR 1) will run per active adapter below.

  const adapters: Adapter[] = (await loadPresentAdapters()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Run adapter-level validation for all discovered adapters, collecting findings.
  const { findings } = await collectFindings(adapters, nodes, verbose);

  // Determine effective severity (CI forces error)
  const { mode, ci } = determineMode(validation);
  logValidationMode(mode, ci, cliValidation, envValidation, adapters, findings.length, verbose);
  emitFindings(findings, mode);

  const active = adapters.filter((a) => nodes.some((n) => a.isNode(n)));
  if (verbose) {
    try {
      console.log(`[exporter][adapters] active=${active.map((a) => a.name).join(",")}`);
      console.log(`[exporter][nodes] count=${nodes.length}${simulate ? " (simulate)" : ""}`);
    } catch {}
  }

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
    if (typeof adapter.validate === "function") {
      // Adapter-level validation receives the full node set so it can detect
      // misclassified nodes (e.g., .go sources missing labels/rule_type).
      await adapter.validate(nodes);
    }
    const nodesA = nodes
      .filter((n) => adapter.isNode(n))
      .sort((a, b) => a.name.localeCompare(b.name));
    const batchesA = await adapter.buildBatches(nodesA);

    // Update metrics immediately from batch tuples (independent of go list warming)
    if (batchesA.length > 0 && (batchesA[0] as any).tuple) {
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

    // If batches carry Go tuples, execute go list to warm cache for labeler
    let goListByBatch: GoListByBatch | undefined = undefined;
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
      goListByBatch = cache as any;
    }

    // Authoritative fallback: if requested and no batches formed (e.g., simulate nodes),
    // still run a go list once to populate cache and enable cache reuse tests.
    if (batchesA.length === 0 && String(process.env.FORCE_AUTHORITATIVE || "") === "1") {
      const first = nodesA.find((n) => isGoNode(n));
      if (first) {
        const tuple = await deriveTupleForNode(first as any);
        const roots = dirsForTarget(first as any);
        const modRoot =
          (await findModuleRootForDirs(roots)) || packageDirFromTargetName(first.name);
        await runGoList(tuple as any, roots as any, modRoot, cacheDir);
      }
    }

    const enriched = await adapter.attachLabels(
      Array.from(byName.values()),
      batchesA as any,
      cacheDir,
      goListByBatch,
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
  // Fallback: in simulate mode or when batches are empty, still include tupleKeys derived per go node
  if (gMetrics.tupleKeys.length === 0) {
    const tuples: string[] = [];
    for (const n of normalized) {
      if (!isGoNode(n)) continue;
      const t = await deriveTupleForNode(n);
      tuples.push(`${t.goos}|${t.goarch}|${t.cgo}|${t.tagsKey}|${t.goflagsKey}|${t.toolchain}`);
    }
    if (tuples.length) {
      gMetrics.totalBatches += tuples.length;
      gMetrics.tupleKeys = Array.from(new Set([...(gMetrics.tupleKeys || []), ...tuples])).sort();
    }
  }
  const GRAPH_SCHEMA = "https://example.com/schemas/buck-graph.schema.json";
  const SCHEMA_VERSION = 1;
  await writeIfChangedJSON(out, {
    $schema: GRAPH_SCHEMA,
    version: SCHEMA_VERSION,
    nodes: normalized,
  });
  if (metricsOut) await emitMetrics(metricsOut, gMetrics);

  // Success banner: point consumers to composite API and schema version
  try {
    console.error(
      `[exporter] graph v${SCHEMA_VERSION} ready — use 'node tools/buck/graph-view.ts' for the Composite Graph API`,
    );
  } catch {}
}

type GoPkgPerBatch = { batch: Batch; pkgs: any[] };

async function emitMetrics(dst: string, m: Metrics) {
  // Bootstrap-safe: rely only on node:fs/promises
  const dir = path.dirname(dst);
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch {}
  await fsp.writeFile(dst, JSON.stringify(m, null, 2) + "\n", "utf8");
}
