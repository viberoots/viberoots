import type { SolverRankedCandidate, SolverRequest } from "./solver-types";
import { mixSeed32, normalizeSeed } from "./seeded-random";

const DEFAULT_SELECTION_WINDOW_SIZE = 3;

function clampSelectionWindowSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SELECTION_WINDOW_SIZE;
  }
  return Math.max(1, Math.min(32, Math.trunc(value)));
}

function placementTokenSet(candidate: SolverRankedCandidate): Set<string> {
  const set = new Set<string>();
  for (const placement of candidate.placements) {
    const flipped = placement.transform.flipped ? "1" : "0";
    set.add(
      `${placement.pieceId}@${placement.position.x},${placement.position.y},${placement.transform.rotation},${flipped}`,
    );
  }
  return set;
}

function candidateDissimilarity(
  left: SolverRankedCandidate,
  right: SolverRankedCandidate,
  leftSet: Set<string>,
  rightSet: Set<string>,
): number {
  if (left.signature === right.signature) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = leftSet.size + rightSet.size - intersection;
  if (union === 0) {
    return 0;
  }
  return 1 - intersection / union;
}

function diversityOrderedWindow(
  candidates: readonly SolverRankedCandidate[],
  windowSize: number,
): SolverRankedCandidate[] {
  const window = [...candidates.slice(0, windowSize)];
  if (window.length <= 2) {
    return window;
  }
  const sets = window.map((candidate) => placementTokenSet(candidate));
  const selectedIndices = [0];
  while (selectedIndices.length < window.length) {
    let bestIndex = -1;
    let bestDistance = -1;
    for (let index = 0; index < window.length; index += 1) {
      if (selectedIndices.includes(index)) {
        continue;
      }
      let minDistanceToSelected = Infinity;
      for (const selectedIndex of selectedIndices) {
        const distance = candidateDissimilarity(
          window[index],
          window[selectedIndex],
          sets[index],
          sets[selectedIndex],
        );
        minDistanceToSelected = Math.min(minDistanceToSelected, distance);
      }
      if (minDistanceToSelected > bestDistance) {
        bestDistance = minDistanceToSelected;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      break;
    }
    selectedIndices.push(bestIndex);
  }
  return selectedIndices.map((index) => window[index]);
}

function paretoFrontWindow(
  candidates: readonly SolverRankedCandidate[],
  windowSize: number,
): SolverRankedCandidate[] {
  const groups = new Map<number, SolverRankedCandidate[]>();
  for (const candidate of candidates) {
    const front = Math.max(0, Math.trunc(candidate.paretoFront ?? 0));
    const queue = groups.get(front) ?? [];
    queue.push(candidate);
    groups.set(front, queue);
  }
  const fronts = [...groups.keys()].sort((left, right) => left - right);
  const selected: SolverRankedCandidate[] = [];
  while (selected.length < windowSize && fronts.length > 0) {
    for (let index = 0; index < fronts.length && selected.length < windowSize; index += 1) {
      const front = fronts[index];
      const queue = groups.get(front);
      const next = queue?.shift();
      if (next) {
        selected.push(next);
      }
      if (!queue || queue.length === 0) {
        groups.delete(front);
        fronts.splice(index, 1);
        index -= 1;
      }
    }
  }
  return selected;
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
  const frontierWindow = paretoFrontWindow(candidates, windowSize);
  const diversityWindow = diversityOrderedWindow(frontierWindow, windowSize);
  const randomWord = mixSeed32(normalizeSeed(request.randomSeed));
  const selectedIndex = randomWord % diversityWindow.length;
  return diversityWindow[selectedIndex];
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
