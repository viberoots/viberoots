import { checkFreshness } from "../../buck/prebuild/freshness";
import { computeCoverageMissing } from "../../buck/prebuild/coverage";
import {
  computeMissingOutputs,
  findMissingNodeImporterProviders,
  findMissingPythonImporterProviders,
} from "../../buck/prebuild/presence";
import { listFreshnessOutputs, listInputs, listOutputs } from "../../buck/prebuild/scan";

type PrebuildSummary = {
  ageDeltaMs?: number;
};

type PrebuildDiagnostics = {
  missingOutputs?: unknown[];
  missingNodeProviders?: unknown[];
  missingPythonProviders?: unknown[];
  coverageMissing?: unknown[];
  summary?: PrebuildSummary;
};

export function prebuildDiagnosticsRequireMaterialize(
  diagnostics: PrebuildDiagnostics | null | undefined,
  skewMs: number,
): boolean {
  if (!diagnostics || typeof diagnostics !== "object") return true;
  const missingOutputs = Array.isArray(diagnostics.missingOutputs)
    ? diagnostics.missingOutputs
    : [];
  const missingNodeProviders = Array.isArray(diagnostics.missingNodeProviders)
    ? diagnostics.missingNodeProviders
    : [];
  const missingPythonProviders = Array.isArray(diagnostics.missingPythonProviders)
    ? diagnostics.missingPythonProviders
    : [];
  const coverageMissing = Array.isArray(diagnostics.coverageMissing)
    ? diagnostics.coverageMissing
    : [];
  const ageDeltaMs = Number(diagnostics.summary?.ageDeltaMs || 0);

  if (missingOutputs.length > 0) return true;
  if (missingNodeProviders.length > 0) return true;
  if (missingPythonProviders.length > 0) return true;
  if (coverageMissing.length > 0) return true;
  if (Number.isFinite(ageDeltaMs) && ageDeltaMs > skewMs) return true;
  return false;
}

export async function shouldMaterializeByDefault(opts: {
  root: string;
  requestedMaterialize: boolean;
  isCI: boolean;
}): Promise<{ materialize: boolean; reason: string }> {
  if (!opts.requestedMaterialize) return { materialize: false, reason: "explicit-no-materialize" };
  if (opts.isCI) return { materialize: true, reason: "ci-default" };
  if ((process.env.VBR_DEVBUILD_FORCE_MATERIALIZE || "").trim() === "1") {
    return { materialize: true, reason: "forced-by-env" };
  }

  const skewMs = Number(process.env.PREBUILD_GUARD_SKEW_MS || "5000");
  try {
    const cwd0 = process.cwd();
    let diagnostics: any = null;
    try {
      process.chdir(opts.root);
      const inputs = await listInputs();
      const outputs = listOutputs();
      const freshnessOutputs = listFreshnessOutputs(outputs);
      const missingOutputs = await computeMissingOutputs(outputs);
      const staleByFreshness = await checkFreshness(inputs, freshnessOutputs, skewMs, "local");
      const missingNodeProviders = await findMissingNodeImporterProviders();
      const missingPythonProviders = await findMissingPythonImporterProviders();
      const coverageMissing = await computeCoverageMissing();
      diagnostics = {
        missingOutputs,
        missingNodeProviders,
        missingPythonProviders,
        coverageMissing,
        summary: {
          ageDeltaMs: staleByFreshness ? skewMs + 1 : 0,
        },
      };
    } finally {
      try {
        process.chdir(cwd0);
      } catch {}
    }
    if (prebuildDiagnosticsRequireMaterialize(diagnostics, skewMs)) {
      return { materialize: true, reason: "prebuild-guard-stale" };
    }
    return { materialize: false, reason: "prebuild-guard-fresh" };
  } catch {
    // Safety-first fallback: if we cannot prove freshness, run the full path.
    return { materialize: true, reason: "prebuild-guard-unavailable" };
  }
}
