#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { autoFixGlue } from "./repair.ts";
import { collectDiagnostics, logList, mtimeSafe } from "./report.ts";
import { hasPatchesOrLocks, listInputs, listOutputs, missingProviderAutos } from "./scan.ts";

type Mode = "ci" | "local";
const mode: Mode = process.env.CI === "true" ? "ci" : "local";
const skewMs = Number(process.env.PREBUILD_GUARD_SKEW_MS || "2000");
const argv = process.argv.slice(2);
const flagVerbose = argv.includes("--verbose") || process.env.PREBUILD_GUARD_VERBOSE === "1";
const jsonOut = argv.includes("--json");

function getVerboseLimit(): number {
  const idx = argv.indexOf("--verbose-limit");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const envN = Number(process.env.PREBUILD_GUARD_LIST_LIMIT || "10");
  return Number.isFinite(envN) && envN > 0 ? envN : 10;
}

const verboseLimit = getVerboseLimit();

export async function run(): Promise<void> {
  const inputs = await listInputs();
  const outputs = listOutputs();

  const outPresence: string[] = [];
  for (const o of outputs) {
    if (!fs.existsSync(o)) outPresence.push(o);
  }
  if (hasPatchesOrLocks(inputs) && missingProviderAutos()) {
    outPresence.push("third_party/providers/TARGETS*.auto");
  }
  const needFixPresence = outPresence.length > 0;

  const presentOutputs = outputs.filter((o) => fs.existsSync(o));
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

  const needFix = needFixPresence || needFixFreshness;

  if (flagVerbose) {
    const sortedInputs = [...inputs].sort((a, b) => (mtimeSafe(b) || 0) - (mtimeSafe(a) || 0));
    const sortedOutputs = [...presentOutputs].sort(
      (a, b) => (mtimeSafe(a) || 0) - (mtimeSafe(b) || 0),
    );
    logList("newer input", sortedInputs, verboseLimit);
    logList("older output", sortedOutputs, verboseLimit);
    for (const o of outPresence.slice(0, verboseLimit)) {
      console.error(`missing output: ${o}`);
    }
  }
  if (jsonOut) {
    const diag = collectDiagnostics(inputs, presentOutputs, outPresence, verboseLimit);
    console.log(JSON.stringify(diag));
    return;
  }

  if (!needFix) return;

  if (mode === "ci") {
    for (const o of outPresence) {
      console.error(
        `ERROR: ${o} missing — run glue generation in this order: export-graph → sync-providers → gen-auto-map`,
      );
    }
    process.exit(1);
  }

  try {
    await autoFixGlue();
  } catch (e) {
    console.error("ERROR: auto-fix failed:", e);
    process.exit(1);
  }
}
