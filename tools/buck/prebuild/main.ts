#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";
import { printSkip } from "../../lib/errors";
import { getFlagBool, getFlagStr } from "../../lib/cli.ts";
import { runNodeWithZx } from "../../lib/node-run.ts";
import { checkNodeDepsInCi } from "../../lib/node-deps-enforcement.ts";
import { autoFixGlue } from "./repair.ts";
import { collectDiagnostics, logList, mtimeSafe } from "./report.ts";
import { listInputs, listOutputs } from "./scan.ts";
import { maybePrintLocalOverridesNotice } from "./notice.ts";
import { maybePrintPatchInvalidationNotes } from "./patch-invalidation-notes.ts";
import {
  computeMissingOutputs,
  findMissingGomod2nixToml,
  findGoImporterMissingSum,
  findMissingNodeImporterProviders,
  findMissingPythonImporterProviders,
} from "./presence.ts";
import { checkFreshness } from "./freshness.ts";
import { computeCoverageMissing, type CoverageMiss } from "./coverage.ts";

type Mode = "ci" | "local";

function getMode(): Mode {
  return process.env.CI === "true" ? "ci" : "local";
}

function getVerboseLimit(flagStr: (n: string, d: string) => string): number {
  const limStr = flagStr("verbose-limit", "");
  if (limStr) {
    const n = Number(limStr);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const envN = Number(process.env.PREBUILD_GUARD_LIST_LIMIT || "10");
  return Number.isFinite(envN) && envN > 0 ? envN : 10;
}

export async function run(): Promise<void> {
  const mode = getMode();
  const skewMs = Number(process.env.PREBUILD_GUARD_SKEW_MS || "5000");
  const flagVerbose = getFlagBool("verbose") || process.env.PREBUILD_GUARD_VERBOSE === "1";
  const jsonOut = getFlagBool("json");
  const flagStrict = getFlagBool("strict");
  const verboseLimit = getVerboseLimit(getFlagStr);

  maybePrintLocalOverridesNotice(mode);
  await maybePrintPatchInvalidationNotes();

  const inputs = await listInputs();
  const outputs = listOutputs();
  const invalidationReportPath = path.join("tools", "buck", "invalidation-report.txt");

  const outPresence = await computeMissingOutputs(outputs);
  const presentOutputs = outputs.filter((o) => fs.existsSync(o));
  const needFixFreshness = checkFreshness(inputs, presentOutputs, skewMs, mode);
  const needFix = outPresence.length > 0 || needFixFreshness;

  const missingNodeProviders = await findMissingNodeImporterProviders();
  const missingPythonProviders = await findMissingPythonImporterProviders();
  const coverageMissing: CoverageMiss[] = await computeCoverageMissing();

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
    (diag as any).missingNodeProviders = missingNodeProviders;
    (diag as any).missingPythonProviders = missingPythonProviders;
    (diag as any).coverageMissing = coverageMissing;
    (diag as any).invalidationReportPath = invalidationReportPath;
    console.log(JSON.stringify(diag));
    return;
  }

  let goMissingSum = findGoImporterMissingSum();
  if (goMissingSum.length) {
    if (mode === "local") {
      try {
        await runNodeWithZx({
          zxInitPath: path.resolve("tools/dev/zx-init.mjs"),
          script: path.resolve("tools/dev/install-deps.ts"),
          args: ["--glue-only"],
        });
      } catch {}
      // Re-check after best-effort local tidy
      goMissingSum = findGoImporterMissingSum();
    }
    if (goMissingSum.length) {
      if (mode === "ci") {
        for (const imp of goMissingSum) {
          console.error(
            `ERROR: ${imp} has go.mod but no go.sum. Run 'tools/dev/install-deps.ts' to auto-tidy or add --skip-go-tidy to bypass`,
          );
        }
        process.exit(1);
      } else {
        for (const imp of goMissingSum) {
          console.warn(
            `WARN: ${imp} has go.mod but no go.sum (local only). You can run 'tools/dev/install-deps.ts' to tidy when online.`,
          );
        }
      }
    }
  }

  const missingGomod = findMissingGomod2nixToml();
  if (missingGomod.length && mode === "ci") {
    for (const m of missingGomod) {
      console.error(
        `ERROR: missing ${m} — run tools/dev/install-deps.ts to generate gomod2nix.toml`,
      );
    }
    process.exit(1);
  }

  if (missingNodeProviders.length) {
    if (mode === "ci") {
      console.error(
        `ERROR: invalidation report: ${invalidationReportPath} (regenerate via: node tools/buck/glue-pipeline.ts)`,
      );
      for (const m of missingNodeProviders) {
        console.error(
          `ERROR: missing Node importer provider: lockfile=${m.lockfile} importer=${m.importer} provider=${m.provider}`,
        );
      }
      process.exit(1);
    }
    if (process.env.PREBUILD_GUARD_NO_FIX === "1") {
      printSkip(
        "missing-required-files",
        "node importer providers missing: " +
          missingNodeProviders
            .map((m) => `${m.provider} for ${m.lockfile}#${m.importer}`)
            .join(", "),
      );
      return;
    }
    try {
      await autoFixGlue();
    } catch (e) {
      console.error("ERROR: auto-fix (sync providers) failed:", e);
      process.exit(1);
    }
  }

  if (missingPythonProviders.length) {
    if (mode === "ci") {
      console.error(
        `ERROR: invalidation report: ${invalidationReportPath} (regenerate via: node tools/buck/glue-pipeline.ts)`,
      );
      for (const m of missingPythonProviders) {
        console.error(
          `ERROR: missing Python importer provider: lockfile=${m.lockfile} importer=${m.importer} provider=${m.provider}`,
        );
      }
      process.exit(1);
    }
    if (process.env.PREBUILD_GUARD_NO_FIX === "1") {
      printSkip(
        "missing-required-files",
        "python importer providers missing: " +
          missingPythonProviders
            .map((m) => `${m.provider} for ${m.lockfile}#${m.importer}`)
            .join(", "),
      );
      return;
    }
    try {
      await autoFixGlue();
    } catch (e) {
      console.error("ERROR: auto-fix (sync providers) failed:", e);
      process.exit(1);
    }
  }

  if (coverageMissing.length > 0) {
    const header =
      mode === "ci" || flagStrict
        ? "ERROR: provider coverage check failed"
        : "WARN: provider coverage check";
    console.error(header);
    if (mode === "ci" || flagStrict) {
      console.error(
        `ERROR: invalidation report: ${invalidationReportPath} (regenerate via: node tools/buck/glue-pipeline.ts)`,
      );
    }
    for (const miss of coverageMissing) {
      if (miss.kind === "provider") {
        console.error(
          `  missing provider for node=${miss.node} expected=${miss.provider} (run sync/generate providers)`,
        );
      } else {
        console.error(
          `  missing mapping in MODULE_PROVIDERS for node=${miss.node} provider=${miss.provider} (run gen-auto-map)`,
        );
      }
    }
    if (mode === "ci" || flagStrict) {
      process.exit(1);
    }
  }

  if (mode === "ci") {
    await checkNodeDepsInCi(path.resolve("."));
  }

  if (!needFix && !missingNodeProviders.length && !missingPythonProviders.length) return;

  if (mode === "ci") {
    if (needFixFreshness || outPresence.length > 0) {
      console.error(
        `ERROR: invalidation report: ${invalidationReportPath} (regenerate via: node tools/buck/glue-pipeline.ts)`,
      );
    }
    if (needFixFreshness && outPresence.length === 0) {
      console.error("ERROR: glue is stale — regenerate via: node tools/buck/glue-pipeline.ts");
    }
    for (const o of outPresence) {
      console.error(
        `ERROR: ${o} missing — run glue generation in this order: export-graph → sync-providers → gen-auto-map`,
      );
    }
    process.exit(1);
  }

  if (process.env.PREBUILD_GUARD_NO_FIX === "1") {
    if (outPresence.length) {
      printSkip("stale-glue", outPresence.join(", "));
    }
    return;
  }
  try {
    await autoFixGlue();
  } catch (e) {
    console.error("ERROR: auto-fix failed:", e);
    process.exit(1);
  }
}
