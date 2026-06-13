#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { logList, mtimeSafe } from "./report";
import { DEFAULT_GRAPH_PATH, DEFAULT_NODE_LOCK_INDEX_PATH } from "../../lib/workspace-state-paths";

export type Mode = "ci" | "local";

export function checkFreshness(
  inputs: string[],
  presentOutputs: string[],
  skewMs: number,
  mode: Mode,
): boolean {
  let needFixFreshness = false;
  if (presentOutputs.length > 0) {
    const newestInput = Math.max(
      0,
      ...inputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
    );
    const oldestOutput = Math.min(
      ...presentOutputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
    );
    if (Number.isFinite(newestInput) && Number.isFinite(oldestOutput)) {
      if (newestInput > oldestOutput + skewMs) {
        needFixFreshness = true;
        if (mode === "ci") {
          console.error(
            `ERROR: glue is stale. Newest input is newer than outputs by ${Math.round(
              (newestInput - oldestOutput) / 1000,
            )}s`,
          );
          const sortedInputs = [...inputs].sort((a, b) => mtimeSafe(b)! - mtimeSafe(a)!);
          const sortedOutputs = [...presentOutputs].sort((a, b) => mtimeSafe(a)! - mtimeSafe(b)!);
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
    if (fs.existsSync(graphPath) && fs.existsSync(sidecarPath)) {
      const mg = mtimeSafe(graphPath) || 0;
      const ms = mtimeSafe(sidecarPath) || 0;
      if (mg > ms) {
        needFixFreshness = true;
        if (mode === "ci") {
          console.error(
            `ERROR: node-lock-index.json is stale by ${Math.round((mg - ms) / 1000)}s versus graph.json`,
          );
        }
      }
    }
  } catch {}

  return needFixFreshness;
}
