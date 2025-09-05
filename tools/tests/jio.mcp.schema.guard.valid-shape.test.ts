#!/usr/bin/env zx-wrapper
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { isZodRawShapeValid } from "../jio/mcp/server.ts";

describe("zod guard — valid shape", () => {
  test("accepts object with Zod members", async () => {
    const { z } = await import("zod");
    const shape: any = { email: z.string(), age: z.number().int() };
    assert.equal(isZodRawShapeValid(shape), true);
  });
});
