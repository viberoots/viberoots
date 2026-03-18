import { createRequire } from "node:module";
import { execSync, spawn } from "node:child_process";

const runnerRequire = createRequire(process.argv[1] ?? import.meta.url);
const { expect, test } = runnerRequire("playwright/test") as any;

const HASH = "#s=AwAAAAAAAEAE";
const APP_URL = `http://localhost:4173/games/pleomino${HASH}`;

function killPort(port: number) {
  const pids = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number(value));
  for (const pid of pids) {
    process.kill(pid, "SIGTERM");
  }
}

test("cold offline reopen can still solve partial board", async ({ browser }) => {
  const server = spawn(
    "zsh",
    [
      "-lc",
      "cd /Users/kiltyj/Code/bucknix-fresh/projects/apps/pleomino && direnv exec /Users/kiltyj/Code/bucknix-fresh pnpm run preview -- --host 127.0.0.1 --port 4173",
    ],
    {
      stdio: "inherit",
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const context = await browser.newContext();
  let page = await context.newPage();
  page.on("console", (msg) => console.log("console:", msg.type(), msg.text()));
  page.on("requestfailed", (req) =>
    console.log("requestfailed:", req.method(), req.url(), req.failure()?.errorText),
  );

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const before = await page.locator("[data-solve-state]").getAttribute("data-solve-state");
  const beforePlaced = await page
    .locator("[data-placed-piece-count]")
    .getAttribute("data-placed-piece-count");
  console.log("before state", before, beforePlaced, await page.url());
  await page.close();

  killPort(4173);
  await context.setOffline(true);
  page = await context.newPage();
  page.on("console", (msg) => console.log("console2:", msg.type(), msg.text()));
  page.on("requestfailed", (req) =>
    console.log("requestfailed2:", req.method(), req.url(), req.failure()?.errorText),
  );
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const afterPlaced = await page
    .locator("[data-placed-piece-count]")
    .getAttribute("data-placed-piece-count")
    .catch(() => null);
  const afterState = await page
    .locator("[data-solve-state]")
    .getAttribute("data-solve-state")
    .catch(() => null);
  console.log("after open", afterState, afterPlaced, await page.url());
  await page.getByRole("button", { name: /solve/i }).click();
  await page.waitForTimeout(2500);
  const finalState = await page
    .locator("[data-solve-state]")
    .getAttribute("data-solve-state")
    .catch(() => null);
  const finalPlaced = await page
    .locator("[data-placed-piece-count]")
    .getAttribute("data-placed-piece-count")
    .catch(() => null);
  const bodyText = await page
    .locator("body")
    .textContent()
    .catch(() => "");
  console.log("final", finalState, finalPlaced, bodyText);

  server.kill("SIGTERM");
  expect(afterPlaced).not.toBe("0");
  expect(finalState).toBe("solved-applied");
});
