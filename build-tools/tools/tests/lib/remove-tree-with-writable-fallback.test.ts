#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { removeTreeWithWritableFallback } from "./test-helpers/remove-tree";

test("removeTreeWithWritableFallback surfaces the second removal failure", async () => {
  const finalError = new Error("still not removable");
  const calls: string[] = [];
  await assert.rejects(
    removeTreeWithWritableFallback("/tmp/example", null, {
      remove: async () => {
        calls.push("remove");
        if (calls.filter((call) => call === "remove").length === 1) {
          throw new Error("read only");
        }
        throw finalError;
      },
      makeWritable: async () => {
        calls.push("writable");
      },
    }),
    (error) => error === finalError,
  );
  assert.deepEqual(calls, ["remove", "writable", "remove"]);
});
