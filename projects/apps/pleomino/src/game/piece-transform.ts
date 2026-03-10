import type { PieceTransform } from "./types";

export const DEFAULT_PIECE_TRANSFORM: PieceTransform = {
  rotation: 0,
  flipped: false,
};

export function rotateTransformClockwise(transform: PieceTransform): PieceTransform {
  return {
    ...transform,
    rotation: (((transform.rotation + 90) % 360) as PieceTransform["rotation"]) || 0,
  };
}

export function rotateTransformCounterClockwise(transform: PieceTransform): PieceTransform {
  return {
    ...transform,
    rotation: (((transform.rotation + 270) % 360) as PieceTransform["rotation"]) || 0,
  };
}

export function flipTransformHorizontally(transform: PieceTransform): PieceTransform {
  return {
    ...transform,
    flipped: !transform.flipped,
  };
}
