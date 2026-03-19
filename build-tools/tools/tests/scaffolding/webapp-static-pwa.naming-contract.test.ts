#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("ts webapp-static-pwa naming contract", async () => {
  await runInTemp("scaf-webapp-static-pwa-contract", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });

    const templates = await $`scaf templates ts --json`;
    const rows = JSON.parse(String(templates.stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    const tsTemplates = new Set(
      rows.filter((row) => row.language === "ts").map((row) => row.template),
    );
    if (!tsTemplates.has("webapp-static-pwa")) {
      throw new Error("expected scaf templates ts to include webapp-static-pwa");
    }

    const help = await $`scaf help ts webapp-static-pwa`;
    const helpText = String(help.stdout || "");
    if (!helpText.includes("scaf new ts webapp-static-pwa <name>")) {
      throw new Error("expected help usage to include webapp-static-pwa");
    }
    if (!helpText.includes("offline app-shell")) {
      throw new Error("expected help notes to mention offline app-shell behavior");
    }
    if (!helpText.includes("Use webapp-ssr-vite or webapp-ssr-next")) {
      throw new Error("expected help notes to mention SSR alternatives");
    }
    if (!helpText.includes("URL hash or browser storage")) {
      throw new Error("expected help notes to mention SSR/hash-state guidance");
    }
    if (!helpText.includes("real local origin")) {
      throw new Error("expected help notes to mention local-origin validation guidance");
    }
    if (!helpText.includes("wasm producers and worker entrypoints")) {
      throw new Error("expected help notes to mention wasm/worker asset guidance");
    }

    await $`scaf new ts webapp-static-pwa demo-pwa --yes --dry-run`;
  });
});
