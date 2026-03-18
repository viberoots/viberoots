import { createRequire } from "node:module";

const runnerRequire = createRequire(process.argv[1] ?? import.meta.url);
const { expect, test } = runnerRequire("playwright/test") as any;

async function dragTrayPieceToBoardCell(page: any, pieceId: string, x: number, y: number) {
  const piece = page.getByRole("button", { name: new RegExp(`^Piece ${pieceId},`) });
  await expect(piece).toBeVisible();

  const pieceBox = await piece.boundingBox();
  if (!pieceBox) {
    throw new Error(`expected bounds for tray piece ${pieceId}`);
  }

  const boardRow = page.getByTestId("pleomino-board-row").nth(y);
  await expect(boardRow).toBeVisible();
  const boardCell = boardRow.getByTestId("pleomino-board-cell").nth(x);
  await expect(boardCell).toBeVisible();
  const boardBox = await boardCell.boundingBox();
  if (!boardBox) {
    throw new Error(`expected bounds for board cell ${x},${y}`);
  }

  const trayFilledCellCenter = {
    x: pieceBox.x + Math.min(21, pieceBox.width / 4),
    y: pieceBox.y + Math.min(21, pieceBox.height / 4),
  };
  await page.mouse.move(trayFilledCellCenter.x, trayFilledCellCenter.y);
  await page.mouse.down();
  await page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2, {
    steps: 24,
  });
  await page.mouse.up();
}

test("places a single purple piece and then solves from that partial board", async ({
  page,
}: {
  page: any;
}) => {
  await page.goto("/games/pleomino");
  await expect(page.locator('#app[data-ui-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="pleomino-solve-state"]');
    const transitions: string[] = [];
    if (target) {
      transitions.push(target.textContent?.trim() ?? "");
      const observer = new MutationObserver(() => {
        transitions.push(target.textContent?.trim() ?? "");
      });
      observer.observe(target, { childList: true, characterData: true, subtree: true });
      (window as Window & { __solveTransitions?: string[] }).__solveTransitions = transitions;
    }
  });

  await dragTrayPieceToBoardCell(page, "purple-2-1", 3, 4);

  await expect(page.getByRole("button", { name: /^Piece purple-2-1, 4 left/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.getByTestId("pleomino-action-solve").click();

  await expect
    .poll(
      async () =>
        page.evaluate(
          () => (window as Window & { __solveTransitions?: string[] }).__solveTransitions ?? [],
        ),
      { timeout: 10_000 },
    )
    .toContain("solved-applied");

  await expect(page.getByRole("button", { name: /^Piece purple-2-1, 5 left/ })).toBeHidden();
});
