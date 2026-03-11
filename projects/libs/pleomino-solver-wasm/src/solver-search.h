#pragma once

#include <cstdint>

namespace pleomino_solver {
using i32 = int32_t;
using u32 = uint32_t;

struct SolverSearchInput {
  const i32* pieceInventory;
  i32 pieceCount;
  const i32* candidatePiece;
  const u32* candidateMasks;
  i32 candidateCount;
  i32 wordCount;
  const i32* cellStarts;
  const i32* cellCandidates;
  i32 cellCount;
  const u32* lockedMask;
  i32 maxNodes;
  i32 maxMillis;
};

struct SolverSearchOutput {
  i32* outCandidates;
  i32 outCandidateStride;
  i32* outUsedBySolution;
  i32* outNodesBySolution;
  i32 outSolutionCapacity;
  i32* outSolutionCount;
  i32* outNodes;
};

i32 solver_search_core(const SolverSearchInput& input, const SolverSearchOutput& output);

}  // namespace pleomino_solver
