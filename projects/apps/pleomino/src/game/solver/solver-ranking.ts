import { buildSolverPreparedInput } from "./candidate-generation";
import {
  canonicalPlacementSignature,
  rankSolutionsByInterestingness,
  scoreInterestingness,
} from "./interestingness";
import {
  diversifyRawCandidatesByStructure,
  structuralBucketKey,
} from "./solver-structural-diversity";
import type { SolverPlacement, SolverRankedCandidate, SolverRequest } from "./solver-types";

function mapCandidatesToPlacements(
  candidateIndices: Int32Array,
  candidates: ReturnType<typeof buildSolverPreparedInput>["candidates"],
): SolverPlacement[] {
  const placements: SolverPlacement[] = [];
  for (const candidateIndex of candidateIndices) {
    const candidate = candidates[candidateIndex];
    if (candidate) {
      placements.push({
        pieceId: candidate.pieceId,
        transform: candidate.transform,
        position: candidate.position,
      });
    }
  }
  return placements;
}

export function rankSolvedCandidates(args: {
  request: SolverRequest;
  lockedPlacements: readonly SolverPlacement[];
  preparedCandidates: ReturnType<typeof buildSolverPreparedInput>["candidates"];
  wasmSolutions: readonly { foundAtNode: number; candidateIndices: Int32Array }[];
}): SolverRankedCandidate[] {
  const rawCandidates = args.wasmSolutions.map((wasmSolution) => {
    const solvedPlacements = mapCandidatesToPlacements(
      wasmSolution.candidateIndices,
      args.preparedCandidates,
    );
    const placements = [...args.lockedPlacements, ...solvedPlacements];
    return {
      placements,
      foundAtNode: wasmSolution.foundAtNode,
      signature: canonicalPlacementSignature(placements),
      structuralBucket: structuralBucketKey(
        placements,
        args.request.boardSize.columns,
        args.request.boardSize.rows,
      ),
    };
  });
  const diversified = diversifyRawCandidatesByStructure(rawCandidates, args.request.randomSeed);
  const bucketCounts = new Map<string, number>();
  for (const candidate of diversified) {
    bucketCounts.set(
      candidate.structuralBucket,
      (bucketCounts.get(candidate.structuralBucket) ?? 0) + 1,
    );
  }
  const maxBucketCount = Math.max(1, ...bucketCounts.values());
  const rankedCandidates = diversified.map((candidate) => {
    const baseScore = scoreInterestingness({
      boardColumns: args.request.boardSize.columns,
      boardRows: args.request.boardSize.rows,
      pieceCatalog: args.request.pieceCatalog,
      placements: candidate.placements,
    });
    const bucketSize = bucketCounts.get(candidate.structuralBucket) ?? maxBucketCount;
    const structuralNovelty = 1 - (bucketSize - 1) / maxBucketCount;
    return {
      placements: candidate.placements,
      foundAtNode: candidate.foundAtNode,
      interestingnessScore:
        Math.round((0.9 * baseScore.score + 0.1 * structuralNovelty) * 1_000_000) / 1_000_000,
      signature: candidate.signature,
      paretoFront: 0,
      structuralBucket: candidate.structuralBucket,
      objectives: {
        ...baseScore.objectives,
        structuralNovelty,
      },
    } satisfies SolverRankedCandidate;
  });
  return rankSolutionsByInterestingness(rankedCandidates);
}
