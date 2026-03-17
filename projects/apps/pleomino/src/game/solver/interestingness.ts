import type { PieceDefinition } from "../types";
import type { SolverPlacement, SolverRankedCandidate } from "./solver-types";
import {
  INTERESTINGNESS_WEIGHTS,
  buildColorBoard,
  colorDistributionScore,
  compositionScore,
  edgeAestheticScore,
  globalMotifScore,
  intentionalContrastScore,
  patternRepetitionScore,
  rhythmScore,
  symmetryScore,
  type InterestingnessObjectiveVector,
} from "./interestingness-metrics";

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function objectiveKeys(): Array<keyof SolverRankedCandidate["objectives"]> {
  return [
    "globalMotif",
    "intentionalContrast",
    "composition",
    "symmetry",
    "colorDistribution",
    "structuralNovelty",
  ];
}

function weightedProfileScore(objectives: InterestingnessObjectiveVector): number {
  const weights = INTERESTINGNESS_WEIGHTS;
  return (
    objectives.symmetry * weights.symmetry +
    objectives.repetition * weights.repetition +
    objectives.rhythm * weights.rhythm +
    objectives.edgeAesthetic * weights.edgeAesthetic +
    objectives.colorDistribution * weights.colorDistribution +
    objectives.globalMotif * weights.globalMotif +
    objectives.intentionalContrast * weights.intentionalContrast +
    objectives.composition * weights.composition
  );
}

export function scoreInterestingness(args: {
  boardColumns: number;
  boardRows: number;
  pieceCatalog: readonly PieceDefinition[];
  placements: readonly SolverPlacement[];
}): {
  score: number;
  objectives: InterestingnessObjectiveVector;
} {
  const board = buildColorBoard(args);
  const objectives: InterestingnessObjectiveVector = {
    symmetry: symmetryScore(board, args.boardColumns, args.boardRows),
    repetition: patternRepetitionScore(board, args.boardColumns, args.boardRows),
    rhythm: rhythmScore(board, args.boardColumns, args.boardRows),
    edgeAesthetic: edgeAestheticScore(board, args.boardColumns, args.boardRows),
    colorDistribution: colorDistributionScore(board, args.boardColumns, args.boardRows),
    globalMotif: globalMotifScore(board, args.boardColumns, args.boardRows),
    intentionalContrast: intentionalContrastScore(board, args.boardColumns, args.boardRows),
    composition: compositionScore(board, args.boardColumns, args.boardRows),
  };
  return {
    score: roundScore(weightedProfileScore(objectives)),
    objectives,
  };
}

export function canonicalPlacementSignature(placements: readonly SolverPlacement[]): string {
  const parts = placements
    .map((placement) => {
      const flipped = placement.transform.flipped ? "1" : "0";
      return `${placement.pieceId}@${placement.position.x},${placement.position.y},${placement.transform.rotation},${flipped}`;
    })
    .sort();
  return parts.join("|");
}

function dominates(left: SolverRankedCandidate, right: SolverRankedCandidate): boolean {
  const keys = objectiveKeys();
  let strictlyBetter = false;
  for (const key of keys) {
    const leftValue = left.objectives[key];
    const rightValue = right.objectives[key];
    if (leftValue < rightValue) {
      return false;
    }
    if (leftValue > rightValue) {
      strictlyBetter = true;
    }
  }
  return strictlyBetter;
}

function nonDominatedSort(
  candidates: readonly SolverRankedCandidate[],
): Array<readonly SolverRankedCandidate[]> {
  if (candidates.length === 0) {
    return [];
  }
  const dominationCounts = new Array<number>(candidates.length).fill(0);
  const dominatedBy: Array<number[]> = Array.from({ length: candidates.length }, () => []);
  const fronts: number[][] = [[]];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = 0; right < candidates.length; right += 1) {
      if (left === right) {
        continue;
      }
      if (dominates(candidates[left], candidates[right])) {
        dominatedBy[left].push(right);
      } else if (dominates(candidates[right], candidates[left])) {
        dominationCounts[left] += 1;
      }
    }
    if (dominationCounts[left] === 0) {
      fronts[0].push(left);
    }
  }
  let frontIndex = 0;
  while ((fronts[frontIndex]?.length ?? 0) > 0) {
    const nextFront: number[] = [];
    for (const winnerIndex of fronts[frontIndex] ?? []) {
      for (const dominatedIndex of dominatedBy[winnerIndex]) {
        dominationCounts[dominatedIndex] -= 1;
        if (dominationCounts[dominatedIndex] === 0) {
          nextFront.push(dominatedIndex);
        }
      }
    }
    frontIndex += 1;
    fronts[frontIndex] = nextFront;
  }
  return fronts
    .filter((front) => front.length > 0)
    .map((front) => front.map((index) => candidates[index]));
}

function crowdingDistance(front: readonly SolverRankedCandidate[]): Map<string, number> {
  const bySignature = new Map<string, number>();
  if (front.length <= 2) {
    for (const candidate of front) {
      bySignature.set(candidate.signature, Number.POSITIVE_INFINITY);
    }
    return bySignature;
  }
  for (const candidate of front) {
    bySignature.set(candidate.signature, 0);
  }
  for (const key of objectiveKeys()) {
    const sorted = [...front].sort((left, right) => left.objectives[key] - right.objectives[key]);
    const first = sorted[0]?.objectives[key] ?? 0;
    const last = sorted[sorted.length - 1]?.objectives[key] ?? 0;
    const range = last - first;
    if (range <= 1e-9) {
      continue;
    }
    bySignature.set(sorted[0]!.signature, Number.POSITIVE_INFINITY);
    bySignature.set(sorted[sorted.length - 1]!.signature, Number.POSITIVE_INFINITY);
    for (let index = 1; index < sorted.length - 1; index += 1) {
      const previous = sorted[index - 1]!.objectives[key];
      const next = sorted[index + 1]!.objectives[key];
      const current = bySignature.get(sorted[index]!.signature) ?? 0;
      if (!Number.isFinite(current)) {
        continue;
      }
      bySignature.set(sorted[index]!.signature, current + (next - previous) / range);
    }
  }
  return bySignature;
}

export function rankSolutionsByInterestingness(
  candidates: readonly SolverRankedCandidate[],
): SolverRankedCandidate[] {
  const fronts = nonDominatedSort(candidates);
  const ranked: SolverRankedCandidate[] = [];
  for (let frontIndex = 0; frontIndex < fronts.length; frontIndex += 1) {
    const front = fronts[frontIndex] ?? [];
    const distances = crowdingDistance(front);
    const sortedFront = [...front].sort((left, right) => {
      const leftDistance = distances.get(left.signature) ?? 0;
      const rightDistance = distances.get(right.signature) ?? 0;
      if (rightDistance !== leftDistance) {
        return rightDistance - leftDistance;
      }
      if (right.interestingnessScore !== left.interestingnessScore) {
        return right.interestingnessScore - left.interestingnessScore;
      }
      if (left.foundAtNode !== right.foundAtNode) {
        return left.foundAtNode - right.foundAtNode;
      }
      return left.signature.localeCompare(right.signature);
    });
    ranked.push(
      ...sortedFront.map((candidate) => ({
        ...candidate,
        paretoFront: frontIndex,
      })),
    );
  }
  return ranked;
}
