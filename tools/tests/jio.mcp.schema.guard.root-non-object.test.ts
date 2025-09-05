#!/usr/bin/env zx-wrapper
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { isZodRawShapeValid } from "../jio/mcp/server.ts";

describe("zod guard — root non-object", () => {
  test("rejects non-object root", async () => {
    const shape: any = "oops" as any;
    assert.equal(isZodRawShapeValid(shape), false);
  });
});
