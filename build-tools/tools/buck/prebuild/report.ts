#!/usr/bin/env zx-wrapper
import { mtimeSafe } from "./scan";

export function logList(name: string, files: string[], limit = 5) {
  const top = files.slice(0, limit);
  for (const f of top) {
    const t = mtimeSafe(f);
    console.error(`${name}: ${t != null ? new Date(t).toISOString() : "(missing)"} ${f}`);
  }
}

export function collectDiagnostics(
  inputs: string[],
  presentOutputs: string[],
  missingOutputs: string[],
  verboseLimit: number,
) {
  const now = Date.now();
  const inputsSorted = [...inputs].sort((a, b) => (mtimeSafe(b) || 0) - (mtimeSafe(a) || 0));
  const outputsSorted = [...presentOutputs].sort(
    (a, b) => (mtimeSafe(a) || 0) - (mtimeSafe(b) || 0),
  );
  const inputsNewest = inputsSorted.slice(0, verboseLimit).map((p) => ({
    path: p,
    mtime: mtimeSafe(p) || 0,
    ageMs: Math.max(0, now - (mtimeSafe(p) || now)),
  }));
  const outputsOldest = outputsSorted.slice(0, verboseLimit).map((p) => ({
    path: p,
    mtime: mtimeSafe(p) || 0,
    ageMs: Math.max(0, now - (mtimeSafe(p) || now)),
  }));
  const newestInput = Math.max(
    0,
    ...inputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
  );
  const oldestOutput = Math.min(
    ...presentOutputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
  );
  const ageDeltaMs =
    Number.isFinite(newestInput) && Number.isFinite(oldestOutput)
      ? Math.max(0, newestInput - oldestOutput)
      : 0;
  return {
    inputsNewest,
    outputsOldest,
    missingOutputs,
    summary: {
      inputCount: inputs.length,
      presentOutputCount: presentOutputs.length,
      missingOutputCount: missingOutputs.length,
      maxInputAgeMs: Math.max(0, ...inputsNewest.map((x) => x.ageMs)),
      minOutputAgeMs: outputsOldest.length > 0 ? Math.min(...outputsOldest.map((x) => x.ageMs)) : 0,
      ageDeltaMs,
    },
  };
}

export { mtimeSafe };
