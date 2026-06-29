#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { logList, mtimeSafe } from "./report";
import { DEFAULT_GRAPH_PATH, DEFAULT_NODE_LOCK_INDEX_PATH } from "../../lib/workspace-state-paths";
import { parseLockfileLabel } from "../../lib/labels";
import { isSupportedImporterLabel } from "../../lib/importers";
import { prebuildFingerprintFresh } from "./fingerprint";

export type Mode = "ci" | "local";

function sortedObject(value: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = value[key];
  }
  return out;
}

function expectedNodeLockIndexFromGraph(graphPath: string): Record<string, string> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    const nodes = Array.isArray(raw) ? raw : Array.isArray(raw?.nodes) ? raw.nodes : [];
    const index: Record<string, string> = {};
    for (const node of nodes) {
      const name = String(node?.name || "").trim();
      if (!name) continue;
      const labels = Array.isArray(node?.labels) ? node.labels.map((l: unknown) => String(l)) : [];
      const locks = labels.filter((label: string) => label.startsWith("lockfile:"));
      if (locks.length !== 1) continue;
      const parsed = parseLockfileLabel(locks[0]);
      if (!parsed || !isSupportedImporterLabel(parsed.importer)) continue;
      index[name] = locks[0].toLowerCase();
    }
    return sortedObject(index);
  } catch {
    return null;
  }
}

function actualNodeLockIndex(sidecarPath: string): Record<string, string> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    const index = raw?.index && typeof raw.index === "object" ? raw.index : {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(index)) {
      out[String(key)] = String(value).toLowerCase();
    }
    return sortedObject(out);
  } catch {
    return null;
  }
}

function nodeLockIndexStaleByContent(graphPath: string, sidecarPath: string): boolean {
  const expected = expectedNodeLockIndexFromGraph(graphPath);
  const actual = actualNodeLockIndex(sidecarPath);
  if (!expected || !actual) return false;
  return JSON.stringify(expected) !== JSON.stringify(actual);
}

export async function checkFreshness(
  inputs: string[],
  outputs: string[],
  skewMs: number,
  mode: Mode,
): Promise<boolean> {
  let needFixFreshness = false;
  if (outputs.length > 0) {
    const fingerprint = await prebuildFingerprintFresh({ inputs, outputs });
    if (!fingerprint.fresh) {
      needFixFreshness = true;
      if (mode === "ci") {
        console.error(`ERROR: prebuild fingerprint is stale: ${fingerprint.reason}`);
        const newestInput = Math.max(
          0,
          ...inputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
        );
        const oldestOutput = Math.min(
          ...outputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
        );
        if (Number.isFinite(newestInput) && Number.isFinite(oldestOutput)) {
          console.error(
            `ERROR: glue is stale. Newest input is newer than outputs by ${Math.round(
              (newestInput - oldestOutput) / 1000,
            )}s`,
          );
          const sortedInputs = [...inputs].sort((a, b) => mtimeSafe(b)! - mtimeSafe(a)!);
          const sortedOutputs = [...outputs].sort((a, b) => mtimeSafe(a)! - mtimeSafe(b)!);
          logList("newer input", sortedInputs, Number(process.env.PREBUILD_GUARD_LIST_LIMIT || 5));
          logList(
            "older output",
            sortedOutputs,
            Number(process.env.PREBUILD_GUARD_LIST_LIMIT || 5),
          );
        }
      }
    }
  }

  try {
    const graphPath = DEFAULT_GRAPH_PATH;
    const sidecarPath = DEFAULT_NODE_LOCK_INDEX_PATH;
    if (
      fs.existsSync(graphPath) &&
      fs.existsSync(sidecarPath) &&
      nodeLockIndexStaleByContent(graphPath, sidecarPath)
    ) {
      needFixFreshness = true;
      if (mode === "ci") {
        console.error("ERROR: node-lock-index.json is stale versus graph.json lockfile labels");
      }
    }
  } catch {}

  return needFixFreshness;
}
