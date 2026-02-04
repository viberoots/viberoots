#!/usr/bin/env zx-wrapper
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool } from "../lib/cli.ts";

async function openInBrowser(filePath: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await $`open ${filePath}`;
      return;
    }
    if (process.platform === "win32") {
      await $`cmd /c start ${filePath}`;
      return;
    }
    // linux and others
    await $`xdg-open ${filePath}`;
  } catch (err) {
    console.error(`Failed to open browser: ${String(err)}`);
  }
}

async function main(): Promise<void> {
  const root = "coverage";
  const wantJson = getFlagBool("json");
  const wantOpen = getFlagBool("open-browser");

  if (!fs.existsSync(root)) {
    const msg = "No coverage yet";
    if (wantJson) {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  const merged = path.join(root, "coverage-summary.json");
  const formatPct = (v: unknown) => (typeof v === "number" ? `${v}%` : "n/a");
  const pick = (t: any) => ({
    lines: t?.lines?.pct ?? 0,
    statements: t?.statements?.pct ?? 0,
    funcs: t?.functions?.pct ?? 0,
    branches: t?.branches?.pct ?? 0,
  });

  let printed = false;

  if (fs.existsSync(merged)) {
    const j = JSON.parse(await fsp.readFile(merged, "utf8"));
    const totals = pick(j.total || {});
    if (wantJson) {
      console.log(JSON.stringify(totals));
    } else {
      const t = j.total || {};
      const line = `all: lines ${formatPct(t.lines?.pct)}, statements ${formatPct(
        t.statements?.pct,
      )}, funcs ${formatPct(t.functions?.pct)}, branches ${formatPct(t.branches?.pct)}`;
      console.log(line);
    }
    printed = true;
  } else {
    // Fallback: per-directory summaries
    const entries = await fsp.readdir(root);
    const perDir: Record<
      string,
      { lines: number; statements: number; funcs: number; branches: number }
    > = {};
    const textLines: string[] = [];
    for (const d of entries) {
      const file = path.join(root, d, "coverage-summary.json");
      if (!fs.existsSync(file)) continue;
      const j = JSON.parse(await fsp.readFile(file, "utf8"));
      const totals = pick(j.total || {});
      perDir[d] = totals;
      if (!wantJson) {
        const t = j.total || {};
        textLines.push(
          `${d}: lines ${formatPct(t.lines?.pct)}, statements ${formatPct(
            t.statements?.pct,
          )}, funcs ${formatPct(t.functions?.pct)}, branches ${formatPct(t.branches?.pct)}`,
        );
      }
    }

    if (Object.keys(perDir).length === 0) {
      const msg = "No coverage yet";
      if (wantJson) {
        console.error(JSON.stringify({ error: msg }));
      } else {
        console.error(msg);
      }
      process.exit(1);
    }

    if (wantJson) {
      console.log(JSON.stringify(perDir));
    } else {
      console.log(textLines.join("\n"));
    }
    printed = true;
  }

  if (wantOpen) {
    const candidates = [
      path.join(root, "index.html"),
      path.join(root, "lcov-report", "index.html"),
      path.join(root, "html", "index.html"),
    ];
    const html = candidates.find((f) => fs.existsSync(f));
    if (html) await openInBrowser(html);
    else if (!wantJson && printed)
      console.error("No HTML report found. Generate with c8 --reporter=html.");
  }
}

await main();
