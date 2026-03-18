import { mixSeed32, normalizeSeed } from "./seeded-random";
import type { SolverPlacement } from "./solver-types";

function quantizeToThirds(value: number, span: number): 0 | 1 | 2 {
  if (span <= 1) {
    return 1;
  }
  const normalized = value / (span - 1);
  if (normalized < 1 / 3) {
    return 0;
  }
  if (normalized < 2 / 3) {
    return 1;
  }
  return 2;
}

export function structuralBucketKey(
  placements: readonly SolverPlacement[],
  boardColumns: number,
  boardRows: number,
): string {
  if (placements.length === 0) {
    return "empty";
  }
  let sumX = 0;
  let sumY = 0;
  let flippedCount = 0;
  const rotationCounts = [0, 0, 0, 0];
  const blackPlacements: Array<{ x: number; y: number }> = [];
  for (const placement of placements) {
    sumX += placement.position.x;
    sumY += placement.position.y;
    if (placement.transform.flipped) {
      flippedCount += 1;
    }
    const rotationIndex = placement.transform.rotation / 90;
    rotationCounts[rotationIndex] = (rotationCounts[rotationIndex] ?? 0) + 1;
    if (placement.pieceId.startsWith("black")) {
      blackPlacements.push(placement.position);
    }
  }
  const centroidX = quantizeToThirds(sumX / placements.length, boardColumns);
  const centroidY = quantizeToThirds(sumY / placements.length, boardRows);
  let dominantRotationIndex = 0;
  for (let index = 1; index < rotationCounts.length; index += 1) {
    if ((rotationCounts[index] ?? 0) > (rotationCounts[dominantRotationIndex] ?? 0)) {
      dominantRotationIndex = index;
    }
  }
  const flippedBin = flippedCount / placements.length >= 0.5 ? 1 : 0;
  if (blackPlacements.length === 0) {
    return `${centroidX}${centroidY}|r${dominantRotationIndex}|f${flippedBin}|b--`;
  }
  const blackMeanX =
    blackPlacements.reduce((sum, point) => sum + point.x, 0) / blackPlacements.length;
  const blackMeanY =
    blackPlacements.reduce((sum, point) => sum + point.y, 0) / blackPlacements.length;
  const blackX = quantizeToThirds(blackMeanX, boardColumns);
  const blackY = quantizeToThirds(blackMeanY, boardRows);
  return `${centroidX}${centroidY}|r${dominantRotationIndex}|f${flippedBin}|b${blackX}${blackY}`;
}

export function diversifyRawCandidatesByStructure<T extends { structuralBucket: string }>(
  candidates: readonly T[],
  randomSeed: number | undefined,
): T[] {
  const bucketOrder = new Map<string, number>();
  const byBucket = new Map<string, T[]>();
  for (const candidate of candidates) {
    if (!bucketOrder.has(candidate.structuralBucket)) {
      bucketOrder.set(candidate.structuralBucket, bucketOrder.size);
      byBucket.set(candidate.structuralBucket, []);
    }
    byBucket.get(candidate.structuralBucket)?.push(candidate);
  }
  const buckets = [...byBucket.keys()].sort(
    (left, right) => (bucketOrder.get(left) ?? 0) - (bucketOrder.get(right) ?? 0),
  );
  if (randomSeed !== undefined && buckets.length > 1) {
    const startOffset = mixSeed32(normalizeSeed(randomSeed)) % buckets.length;
    const rotated = buckets.slice(startOffset).concat(buckets.slice(0, startOffset));
    buckets.splice(0, buckets.length, ...rotated);
  }
  const result: T[] = [];
  let remaining = candidates.length;
  let bucketCursor = 0;
  while (remaining > 0 && buckets.length > 0) {
    const bucketKey = buckets[bucketCursor % buckets.length];
    const queue = byBucket.get(bucketKey);
    const next = queue?.shift();
    if (next) {
      result.push(next);
      remaining -= 1;
    }
    if (!queue || queue.length === 0) {
      byBucket.delete(bucketKey);
      const removeAt = buckets.indexOf(bucketKey);
      if (removeAt >= 0) {
        buckets.splice(removeAt, 1);
      }
      continue;
    }
    bucketCursor += 1;
  }
  return result;
}
