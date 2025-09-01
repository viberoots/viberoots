#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import { discoverJioTools } from "../jio/core/index.ts";

describe("jio mcp — register", () => {
  test("discovers tools and has schemas", async () => {
    const { index, specs } = await discoverJioTools();
    if (index.size < 1 || specs.size < 1) {
      console.error("expected discovered tools");
      process.exit(2);
    }
    for (const [fq, spec] of specs) {
      if (!fq || !spec || !spec.command?.package || !spec.tool?.name) {
        console.error("invalid spec in registry");
        process.exit(2);
      }
    }
  });
});
