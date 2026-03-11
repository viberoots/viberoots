import type { SolverRankedCandidate, SolverRequest } from "./solver-types";

const DEFAULT_SELECTION_WINDOW_SIZE = 3;

function normalizeSeed(seed: number): number {
  const value = Math.trunc(seed);
  const normalized = value >>> 0;
  return normalized === 0 ? 0x9e3779b9 : normalized;
}

function clampSelectionWindowSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SELECTION_WINDOW_SIZE;
  }
  return Math.max(1, Math.min(32, Math.trunc(value)));
}

function mixSeed32(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

export function selectSeededRankedCandidate(
  candidates: readonly SolverRankedCandidate[],
  request: SolverRequest,
): SolverRankedCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (request.randomSeed === undefined) {
    return candidates[0];
  }
  const windowSize = Math.min(
    candidates.length,
    clampSelectionWindowSize(request.selectionWindowSize),
  );
  const randomWord = mixSeed32(normalizeSeed(request.randomSeed));
  const selectedIndex = randomWord % windowSize;
  return candidates[selectedIndex];
}

export function dedupeRankedCandidatesBySignature(
  candidates: readonly SolverRankedCandidate[],
): SolverRankedCandidate[] {
  const bySignature = new Map<string, SolverRankedCandidate>();
  for (const candidate of candidates) {
    if (bySignature.has(candidate.signature)) {
      continue;
    }
    bySignature.set(candidate.signature, candidate);
  }
  return [...bySignature.values()];
}
