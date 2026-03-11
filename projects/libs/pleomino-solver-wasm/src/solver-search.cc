#include "solver-search.h"

#include <cstdlib>

namespace pleomino_solver {
namespace {
struct SearchCtx {
  const i32* candidatePiece;
  const u32* candidateMasks;
  const i32* cellStarts;
  const i32* cellCandidates;
  i32 cellCount;
  i32 pieceCount;
  i32 wordCount;
  i32 candidateCount;
  i32 maxNodes;
  i32* outCandidates;
  i32 outCandidateStride;
  i32* outUsedBySolution;
  i32* outNodesBySolution;
  i32 outSolutionCapacity;
  i32* outSolutionCount;
  i32* outNodes;
  i32 nodeCount;
  i32 solutionCount;
  bool stop;
};

inline bool maskIntersects(const u32* left, const u32* right, i32 wordCount) {
  for (i32 index = 0; index < wordCount; index += 1) {
    if ((left[index] & right[index]) != 0U) {
      return true;
    }
  }
  return false;
}

inline void maskOrInPlace(u32* dst, const u32* src, i32 wordCount) {
  for (i32 index = 0; index < wordCount; index += 1) {
    dst[index] |= src[index];
  }
}

inline void maskXorInPlace(u32* dst, const u32* src, i32 wordCount) {
  for (i32 index = 0; index < wordCount; index += 1) {
    dst[index] ^= src[index];
  }
}

inline bool cellOccupied(const u32* occupancy, i32 cellIndex) {
  const i32 wordIndex = cellIndex >> 5;
  const i32 bitIndex = cellIndex & 31;
  return ((occupancy[wordIndex] >> bitIndex) & 1U) != 0U;
}

inline bool budgetExceeded(const SearchCtx& ctx) {
  if (ctx.maxNodes > 0 && ctx.nodeCount >= ctx.maxNodes) {
    return true;
  }
  return false;
}

void captureSolution(SearchCtx& ctx, const i32* stack, i32 depth) {
  if (ctx.solutionCount >= ctx.outSolutionCapacity || depth > ctx.outCandidateStride) {
    ctx.stop = true;
    return;
  }
  const i32 slot = ctx.solutionCount;
  const i32 base = slot * ctx.outCandidateStride;
  for (i32 index = 0; index < depth; index += 1) {
    ctx.outCandidates[base + index] = stack[index];
  }
  ctx.outUsedBySolution[slot] = depth;
  ctx.outNodesBySolution[slot] = ctx.nodeCount;
  ctx.solutionCount += 1;
  if (ctx.solutionCount >= ctx.outSolutionCapacity) {
    ctx.stop = true;
  }
}

void dfs(SearchCtx& ctx, i32* pieceInventory, u32* occupancy, i32* stack, i32 depth) {
  if (ctx.stop || budgetExceeded(ctx)) {
    ctx.stop = true;
    return;
  }

  i32 bestCell = -1;
  i32 bestCount = 0;

  for (i32 cell = 0; cell < ctx.cellCount; cell += 1) {
    if (cellOccupied(occupancy, cell)) {
      continue;
    }
    const i32 start = ctx.cellStarts[cell];
    const i32 end = ctx.cellStarts[cell + 1];
    i32 viable = 0;
    for (i32 cursor = start; cursor < end; cursor += 1) {
      const i32 candidateIndex = ctx.cellCandidates[cursor];
      if (candidateIndex < 0 || candidateIndex >= ctx.candidateCount) {
        continue;
      }
      const i32 pieceIndex = ctx.candidatePiece[candidateIndex];
      if (pieceIndex < 0 || pieceIndex >= ctx.pieceCount || pieceInventory[pieceIndex] <= 0) {
        continue;
      }
      const u32* candidateMask = &ctx.candidateMasks[candidateIndex * ctx.wordCount];
      if (!maskIntersects(occupancy, candidateMask, ctx.wordCount)) {
        viable += 1;
      }
    }
    if (viable == 0) {
      return;
    }
    if (bestCell < 0 || viable < bestCount) {
      bestCell = cell;
      bestCount = viable;
      if (bestCount == 1) {
        break;
      }
    }
  }

  if (bestCell < 0) {
    captureSolution(ctx, stack, depth);
    return;
  }

  const i32 start = ctx.cellStarts[bestCell];
  const i32 end = ctx.cellStarts[bestCell + 1];
  for (i32 cursor = start; cursor < end; cursor += 1) {
    if (ctx.stop) {
      return;
    }
    const i32 candidateIndex = ctx.cellCandidates[cursor];
    if (candidateIndex < 0 || candidateIndex >= ctx.candidateCount) {
      continue;
    }
    const i32 pieceIndex = ctx.candidatePiece[candidateIndex];
    if (pieceIndex < 0 || pieceIndex >= ctx.pieceCount || pieceInventory[pieceIndex] <= 0) {
      continue;
    }
    const u32* candidateMask = &ctx.candidateMasks[candidateIndex * ctx.wordCount];
    if (maskIntersects(occupancy, candidateMask, ctx.wordCount)) {
      continue;
    }

    ctx.nodeCount += 1;
    if (budgetExceeded(ctx)) {
      ctx.stop = true;
      return;
    }

    pieceInventory[pieceIndex] -= 1;
    maskOrInPlace(occupancy, candidateMask, ctx.wordCount);
    stack[depth] = candidateIndex;

    dfs(ctx, pieceInventory, occupancy, stack, depth + 1);

    maskXorInPlace(occupancy, candidateMask, ctx.wordCount);
    pieceInventory[pieceIndex] += 1;
  }
}
}  // namespace

i32 solver_search_core(const SolverSearchInput& input, const SolverSearchOutput& output) {
  auto* mutableInventory = static_cast<i32*>(std::malloc(static_cast<size_t>(input.pieceCount) * sizeof(i32)));
  auto* mutableOccupancy = static_cast<u32*>(std::malloc(static_cast<size_t>(input.wordCount) * sizeof(u32)));
  auto* stack = static_cast<i32*>(std::malloc(static_cast<size_t>(output.outCandidateStride) * sizeof(i32)));
  if (!mutableInventory || !mutableOccupancy || !stack) {
    std::free(mutableInventory);
    std::free(mutableOccupancy);
    std::free(stack);
    return -2;
  }

  for (i32 index = 0; index < input.pieceCount; index += 1) {
    mutableInventory[index] = input.pieceInventory[index];
  }
  for (i32 index = 0; index < input.wordCount; index += 1) {
    mutableOccupancy[index] = input.lockedMask[index];
  }
  for (i32 index = 0; index < output.outSolutionCapacity; index += 1) {
    output.outUsedBySolution[index] = 0;
    output.outNodesBySolution[index] = 0;
  }
  *output.outSolutionCount = 0;
  *output.outNodes = 0;

  SearchCtx ctx{input.candidatePiece,
                input.candidateMasks,
                input.cellStarts,
                input.cellCandidates,
                input.cellCount,
                input.pieceCount,
                input.wordCount,
                input.candidateCount,
                input.maxNodes,
                output.outCandidates,
                output.outCandidateStride,
                output.outUsedBySolution,
                output.outNodesBySolution,
                output.outSolutionCapacity,
                output.outSolutionCount,
                output.outNodes,
                0,
                0,
                false};

  dfs(ctx, mutableInventory, mutableOccupancy, stack, 0);
  *output.outSolutionCount = ctx.solutionCount;
  *output.outNodes = ctx.nodeCount;

  std::free(stack);
  std::free(mutableInventory);
  std::free(mutableOccupancy);
  return ctx.solutionCount > 0 ? 1 : 0;
}

}  // namespace pleomino_solver
