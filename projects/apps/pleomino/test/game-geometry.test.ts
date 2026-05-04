import { describe, expect, it } from "vitest";
import {
  canonicalCellSignature,
  normalizeCells,
  transformCells,
  translateCells,
} from "../src/game/geometry";
import type { Cell } from "../src/game/types";

const lPiece: Cell[] = [
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

describe("game geometry", () => {
  it("rotation is deterministic across all quarter turns", () => {
    const rotate0 = transformCells(lPiece, { rotation: 0, flipped: false });
    const rotate90 = transformCells(lPiece, { rotation: 90, flipped: false });
    const rotate180 = transformCells(lPiece, { rotation: 180, flipped: false });
    const rotate270 = transformCells(lPiece, { rotation: 270, flipped: false });
    const rotate360 = transformCells(rotate270, { rotation: 90, flipped: false });

    expect(
      new Set([rotate0, rotate90, rotate180, rotate270].map(canonicalCellSignature)).size,
    ).toBe(4);
    expect(canonicalCellSignature(rotate360)).toBe(canonicalCellSignature(rotate0));
  });

  it("flip is deterministic and composable with rotation", () => {
    const rotateThenFlip = transformCells(
      transformCells(lPiece, { rotation: 90, flipped: false }),
      { rotation: 0, flipped: true },
    );
    const flipThenRotate = transformCells(transformCells(lPiece, { rotation: 0, flipped: true }), {
      rotation: 270,
      flipped: false,
    });

    expect(canonicalCellSignature(rotateThenFlip)).toBe(canonicalCellSignature(flipThenRotate));
  });

  it("normalization is stable for equivalent shapes", () => {
    const translated = translateCells(lPiece, { x: 8, y: 5 });
    const reversed = [...translated].reverse();

    expect(normalizeCells(translated)).toEqual(normalizeCells(reversed));
  });
});
