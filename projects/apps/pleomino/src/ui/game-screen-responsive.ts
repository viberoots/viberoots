import { BOARD_CELL_SIZE } from "../game/board";

const PAGE_HORIZONTAL_PADDING = 2;
const PAGE_VERTICAL_PADDING = 2;
const LAYOUT_GAP = 4;
const BOARD_CARD_PADDING = 6;
const BOARD_CARD_BORDER = 1;
const DESKTOP_TRAY_MAX_ROW_UNITS = 7;
const DESKTOP_TRAY_COLUMN_GAP = 18;
const DESKTOP_TRAY_HORIZONTAL_PADDING = 12;
const MIN_CELL_SIZE = 24;
const STACKED_MAX_CELL_SIZE = 56;
const DESKTOP_MAX_CELL_SIZE = 72;
const MOBILE_BREAKPOINT_PX = 900;
const STACKED_TRAY_HEIGHT_CHROME = 58;
const STACKED_TOTAL_CELL_ROWS = 24;
const STACKED_BOTTOM_SAFE_PX = 2;
const DESKTOP_TOOLBAR_HEIGHT_CHROME = 48;
const DESKTOP_BOTTOM_SAFE_PX = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type ResponsiveMetrics = {
  cellSize: number;
  isStacked: boolean;
  cardWidth: number | string;
};

export function computeResponsiveMetrics(
  viewportWidth: number,
  viewportHeight: number,
): ResponsiveMetrics {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return {
      cellSize: BOARD_CELL_SIZE,
      isStacked: false,
      cardWidth:
        BOARD_CELL_SIZE * DESKTOP_TRAY_MAX_ROW_UNITS +
        DESKTOP_TRAY_COLUMN_GAP +
        DESKTOP_TRAY_HORIZONTAL_PADDING,
    };
  }

  const isStacked = viewportWidth < MOBILE_BREAKPOINT_PX;
  const boardChrome = BOARD_CARD_PADDING * 2 + BOARD_CARD_BORDER * 2;
  const desktopTrayChrome = DESKTOP_TRAY_COLUMN_GAP + DESKTOP_TRAY_HORIZONTAL_PADDING;
  const maxCellSizeByWidth = isStacked
    ? Math.floor((viewportWidth - PAGE_HORIZONTAL_PADDING * 2 - boardChrome) / 10)
    : Math.floor(
        (viewportWidth -
          PAGE_HORIZONTAL_PADDING * 2 -
          LAYOUT_GAP -
          boardChrome -
          desktopTrayChrome) /
          (10 + DESKTOP_TRAY_MAX_ROW_UNITS),
      );
  const maxCellSizeByHeight = isStacked
    ? Math.floor(
        (viewportHeight -
          PAGE_VERTICAL_PADDING -
          STACKED_BOTTOM_SAFE_PX -
          LAYOUT_GAP -
          STACKED_TRAY_HEIGHT_CHROME) /
          STACKED_TOTAL_CELL_ROWS,
      )
    : Math.floor(
        (viewportHeight -
          PAGE_VERTICAL_PADDING * 2 -
          LAYOUT_GAP -
          DESKTOP_TOOLBAR_HEIGHT_CHROME -
          boardChrome -
          DESKTOP_BOTTOM_SAFE_PX) /
          15,
      );

  const cellSize = clamp(
    Math.min(
      isStacked ? STACKED_MAX_CELL_SIZE : DESKTOP_MAX_CELL_SIZE,
      maxCellSizeByWidth,
      maxCellSizeByHeight,
    ),
    MIN_CELL_SIZE,
    isStacked ? STACKED_MAX_CELL_SIZE : DESKTOP_MAX_CELL_SIZE,
  );
  const cardWidth = isStacked
    ? viewportWidth - PAGE_HORIZONTAL_PADDING * 2
    : cellSize * DESKTOP_TRAY_MAX_ROW_UNITS + desktopTrayChrome;
  return { cellSize, isStacked, cardWidth };
}
