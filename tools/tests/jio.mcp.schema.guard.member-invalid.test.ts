#!/usr/bin/env zx-wrapper
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { isZodRawShapeValid } from "../jio/mcp/server.ts";

describe("zod guard — member invalid", () => {
  test("rejects object with non-Zod member", async () => {
    const { z } = await import("zod");
    const shape: any = { ok: z.string(), bad: 123 as any };
    assert.equal(isZodRawShapeValid(shape), false);
  });
});
