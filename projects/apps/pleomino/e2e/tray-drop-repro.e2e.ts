import { createRequire } from "node:module";

const runnerRequire = createRequire(process.argv[1] ?? import.meta.url);
const { expect, test } = runnerRequire("playwright/test") as any;

const REPRO_HASH =
  "s=AygBKDMmYQYwAjSfNLExGzHVNBgy9DUCKAIcAhACBAYkBhgGDAYAnwSfKJ8cnxDVKNUc1RDVBBslGxkbDRsBsSWxGbENsQHUKdQd1BEYJhgaGA7UBRgC";
const PURPLE_COLOR = "rgb(168, 85, 247)";

async function purpleBoardCellCenter(page: any): Promise<{ x: number; y: number } | null> {
  const cells = page.locator('[data-testid="pleomino-board-cell"]');
  const candidates = await cells.evaluateAll((elements, targetColor) => {
    return elements
      .map((element) => {
        const color = getComputedStyle(element).backgroundColor;
        if (color !== targetColor) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        const x = Number(element.getAttribute("data-cell-x") ?? "-1");
        const y = Number(element.getAttribute("data-cell-y") ?? "-1");
        return {
          color,
          x,
          y,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      })
      .filter((entry) => entry !== null)
      .sort((left, right) => {
        if (left.y !== right.y) {
          return left.y - right.y;
        }
        return right.x - left.x;
      });
  }, PURPLE_COLOR);

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const topRightPurple = candidates[0] as { centerX: number; centerY: number };
  return { x: topRightPurple.centerX, y: topRightPurple.centerY };
}

test("drops immediately when returning a board piece to its tray slot", async ({
  page,
}: {
  page: any;
}) => {
  await page.goto(`/games/pleomino#${REPRO_HASH}`);

  const trayPurple = page.getByRole("button", { name: /^Piece purple-2-1,/ });
  await expect(trayPurple).toBeVisible();

  const boardPurplePoint = await purpleBoardCellCenter(page);
  if (!boardPurplePoint) {
    throw new Error("expected purple piece cell on board from repro hash");
  }

  const trayBox = await trayPurple.boundingBox();
  if (!trayBox) {
    throw new Error("expected purple tray piece bounds");
  }
  const trayDropPoint = {
    x: trayBox.x + trayBox.width * 0.45,
    y: trayBox.y + trayBox.height * 0.5,
  };

  await page.mouse.move(boardPurplePoint.x, boardPurplePoint.y);
  await page.mouse.down();
  await page.mouse.move(trayDropPoint.x, trayDropPoint.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const ghostVisible = await page
    .getByTestId("pleomino-drag-ghost")
    .isVisible()
    .catch(() => false);
  expect(ghostVisible).toBe(false);

  await page.mouse.move(trayDropPoint.x + 40, trayDropPoint.y + 30);
  await page.waitForTimeout(50);
  const ghostAfterMove = await page
    .getByTestId("pleomino-drag-ghost")
    .isVisible()
    .catch(() => false);
  expect(ghostAfterMove).toBe(false);
});
