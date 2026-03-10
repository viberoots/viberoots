import type { BoardSize } from "./types";

export const BOARD_COLUMNS = 10;
export const BOARD_ROWS = 15;
export const BOARD_CELL_SIZE = 32;
export const PIECE_TYPE_INITIAL_SUPPLY = 5;

export const BOARD_SIZE: BoardSize = {
  columns: BOARD_COLUMNS,
  rows: BOARD_ROWS,
};

export const BOARD_CELL_COUNT = BOARD_COLUMNS * BOARD_ROWS;
