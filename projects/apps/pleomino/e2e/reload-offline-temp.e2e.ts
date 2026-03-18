import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const runnerRequire = createRequire(process.argv[1] ?? import.meta.url);
const { expect, test } = runnerRequire("playwright/test") as any;

test("reloads from service worker when server is gone", async ({ page }) => {
  page.on("requestfailed", (req) =>
    console.log("requestfailed:", req.method(), req.url(), req.failure()?.errorText),
  );
  page.on("console", (msg) => console.log("console:", msg.type(), msg.text()));

  await page.goto("/games/pleomino", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const swState = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return { controller: false, ready: false };
    }
    const registration = await navigator.serviceWorker.ready;
    return {
      controller: navigator.serviceWorker.controller !== null,
      ready: registration.active !== null,
    };
  });
  console.log("sw state", JSON.stringify(swState));

  const pids = execSync("lsof -ti tcp:4173", { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number(value));
  for (const pid of pids) {
    process.kill(pid, "SIGTERM");
  }
  await page.waitForTimeout(500);

  let reloadFailed = false;
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
  } catch (error) {
    reloadFailed = true;
    console.log("reload error", error instanceof Error ? error.message : String(error));
  }

  const bodyText = await page
    .locator("body")
    .textContent()
    .catch(() => "");
  const hydrated = await page
    .locator("#app")
    .getAttribute("data-client-hydrated")
    .catch(() => null);
  console.log("body text", bodyText);
  console.log("hydrated", hydrated);
  expect(reloadFailed).toBe(false);
  expect(bodyText).toContain("Pleomino");
});
