#include <cstdint>
#include <cstdlib>
#include <ctime>
namespace {
using i32 = int32_t;
using u32 = uint32_t;

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
  i32 maxMillis;
  std::clock_t startClock;
  i32* outCandidates;
  i32 outCapacity;
  i32* outUsed;
  i32* outNodes;
  i32 nodeCount;
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

inline i32 elapsedMillis(const SearchCtx& ctx) {
  if (ctx.maxMillis <= 0) {
    return 0;
  }
  const auto now = std::clock();
  const auto ticks = now - ctx.startClock;
  return static_cast<i32>((1000.0 * static_cast<double>(ticks)) / CLOCKS_PER_SEC);
}

inline bool budgetExceeded(const SearchCtx& ctx) {
  if (ctx.maxNodes > 0 && ctx.nodeCount >= ctx.maxNodes) {
    return true;
  }
  if (ctx.maxMillis > 0 && elapsedMillis(ctx) >= ctx.maxMillis) {
    return true;
  }
  return false;
}

bool dfs(SearchCtx& ctx, i32* pieceInventory, u32* occupancy, i32* stack, i32 depth) {
  if (budgetExceeded(ctx)) {
    return false;
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
      if (pieceIndex < 0 || pieceIndex >= ctx.pieceCount) {
        continue;
      }
      if (pieceInventory[pieceIndex] <= 0) {
        continue;
      }
      const u32* candidateMask = &ctx.candidateMasks[candidateIndex * ctx.wordCount];
      if (maskIntersects(occupancy, candidateMask, ctx.wordCount)) {
        continue;
      }
      viable += 1;
    }

    if (viable == 0) {
      return false;
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
    if (depth <= ctx.outCapacity) {
      for (i32 index = 0; index < depth; index += 1) {
        ctx.outCandidates[index] = stack[index];
      }
      *ctx.outUsed = depth;
      *ctx.outNodes = ctx.nodeCount;
      return true;
    }
    return false;
  }

  const i32 start = ctx.cellStarts[bestCell];
  const i32 end = ctx.cellStarts[bestCell + 1];
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
    if (maskIntersects(occupancy, candidateMask, ctx.wordCount)) {
      continue;
    }

    ctx.nodeCount += 1;
    if (budgetExceeded(ctx)) {
      return false;
    }

    pieceInventory[pieceIndex] -= 1;
    maskOrInPlace(occupancy, candidateMask, ctx.wordCount);
    stack[depth] = candidateIndex;

    if (dfs(ctx, pieceInventory, occupancy, stack, depth + 1)) {
      return true;
    }

    maskXorInPlace(occupancy, candidateMask, ctx.wordCount);
    pieceInventory[pieceIndex] += 1;
  }

  return false;
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
                  i32 outCapacity,
                  i32* outUsed,
                  i32* outNodes) {
  if (pieceCount < 0 || candidateCount < 0 || wordCount <= 0 || cellCount < 0 || outCapacity < 0) {
    return -1;
  }
  if (!pieceInventory || !candidatePiece || !candidateMasks || !cellStarts || !cellCandidates ||
      !lockedMask || !outCandidates || !outUsed || !outNodes) {
    return -1;
  }

  auto* mutableInventory = static_cast<i32*>(std::malloc(static_cast<size_t>(pieceCount) * sizeof(i32)));
  auto* mutableOccupancy = static_cast<u32*>(std::malloc(static_cast<size_t>(wordCount) * sizeof(u32)));
  auto* stack = static_cast<i32*>(std::malloc(static_cast<size_t>(outCapacity) * sizeof(i32)));

  if (!mutableInventory || !mutableOccupancy || !stack) {
    std::free(mutableInventory);
    std::free(mutableOccupancy);
    std::free(stack);
    return -2;
  }

  for (i32 index = 0; index < pieceCount; index += 1) {
    mutableInventory[index] = pieceInventory[index];
  }
  for (i32 index = 0; index < wordCount; index += 1) {
    mutableOccupancy[index] = lockedMask[index];
  }

  *outUsed = 0;
  *outNodes = 0;

  SearchCtx ctx{
      candidatePiece, candidateMasks, cellStarts, cellCandidates, cellCount,
      pieceCount,      wordCount,      candidateCount, maxNodes, maxMillis,
      std::clock(),    outCandidates,  outCapacity,    outUsed,  outNodes,
      0,
  };

  const bool solved = dfs(ctx, mutableInventory, mutableOccupancy, stack, 0);
  *outNodes = ctx.nodeCount;

  std::free(stack);
  std::free(mutableInventory);
  std::free(mutableOccupancy);

  return solved ? 1 : 0;
}

}
