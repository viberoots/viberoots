#include "solver-search.h"

#include <cstdint>
#include <cstdlib>

namespace {
using i32 = int32_t;
using u32 = uint32_t;

bool is_invalid_base_input(i32 pieceCount,
                           i32 candidateCount,
                           i32 wordCount,
                           i32 cellCount,
                           i32 outCandidateStride,
                           i32 outSolutionCapacity) {
  return pieceCount < 0 || candidateCount < 0 || wordCount <= 0 || cellCount < 0 ||
         outCandidateStride < 0 || outSolutionCapacity <= 0;
}

bool has_null_input(const i32* pieceInventory,
                    const i32* candidatePiece,
                    const u32* candidateMasks,
                    const i32* cellStarts,
                    const i32* cellCandidates,
                    const u32* lockedMask,
                    i32* outCandidates,
                    i32* outUsedBySolution,
                    i32* outNodesBySolution,
                    i32* outSolutionCount,
                    i32* outNodes) {
  return !pieceInventory || !candidatePiece || !candidateMasks || !cellStarts || !cellCandidates ||
         !lockedMask || !outCandidates || !outUsedBySolution || !outNodesBySolution ||
         !outSolutionCount || !outNodes;
}
}  // namespace

extern "C" {

i32 solver_alloc(i32 byteCount) {
  if (byteCount <= 0) {
    return 0;
  }
  return static_cast<i32>(reinterpret_cast<intptr_t>(std::malloc(static_cast<size_t>(byteCount))));
}

void solver_free(i32 ptr) {
  if (ptr == 0) {
    return;
  }
  std::free(reinterpret_cast<void*>(static_cast<intptr_t>(ptr)));
}

i32 solver_search(const i32* pieceInventory,
                  i32 pieceCount,
                  const i32* candidatePiece,
                  const u32* candidateMasks,
                  i32 candidateCount,
                  i32 wordCount,
                  const i32* cellStarts,
                  const i32* cellCandidates,
                  i32 cellCount,
                  const u32* lockedMask,
                  i32 maxNodes,
                  i32 maxMillis,
                  i32* outCandidates,
                  i32 outCandidateStride,
                  i32* outUsedBySolution,
                  i32* outNodesBySolution,
                  i32 outSolutionCapacity,
                  i32* outSolutionCount,
                  i32* outNodes) {
  if (is_invalid_base_input(
          pieceCount, candidateCount, wordCount, cellCount, outCandidateStride, outSolutionCapacity)) {
    return -1;
  }
  if (has_null_input(pieceInventory,
                     candidatePiece,
                     candidateMasks,
                     cellStarts,
                     cellCandidates,
                     lockedMask,
                     outCandidates,
                     outUsedBySolution,
                     outNodesBySolution,
                     outSolutionCount,
                     outNodes)) {
    return -1;
  }

  const pleomino_solver::SolverSearchInput input{
      pieceInventory, pieceCount, candidatePiece, candidateMasks, candidateCount,
      wordCount,      cellStarts, cellCandidates, cellCount,      lockedMask,
      maxNodes,       maxMillis,
  };
  const pleomino_solver::SolverSearchOutput output{
      outCandidates,
      outCandidateStride,
      outUsedBySolution,
      outNodesBySolution,
      outSolutionCapacity,
      outSolutionCount,
      outNodes,
  };
  return pleomino_solver::solver_search_core(input, output);
}

}  // extern "C"
