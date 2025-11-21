#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("scaf templates python lists lib and app", async () => {
  await runInTemp("scaf-templates-python", async (_tmp, $) => {
    const { stdout } = await $`scaf templates python --json`;
    const arr = JSON.parse(stdout || "[]") as Array<{ language: string; template: string }>;
    const forPy = arr.filter((m) => m.language === "python").map((m) => m.template);
    const need = new Set(["lib", "app"]);
    for (const t of need) {
      if (!forPy.includes(t)) {
        console.error("missing python template:", t);
        process.exit(2);
      }
    }
  });
});
