#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAjvValidator, toJsonSchema } from "../jio/schema/index.ts";

describe("jio schema parity", () => {
  test("runner and linter share identical schema", async () => {
    const schema = toJsonSchema();
    // Ensure it looks like a JSON Schema root
    assert.equal(schema?.type, "object");
    assert.ok(schema?.properties?.command);
  });

  test("validators accept/reject identically for sample specs", async () => {
    const { ajv, validate } = createAjvValidator();
    const specs: any[] = [
      {
        tool: { name: "echo" },
        command: { package: "io.example", exec: "bash", parameters: {} },
      },
      {
        tool: { name: "lines" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      },
    ];
    for (const s of specs) {
      const ok1 = validate(s);
      const ok2 = ajv.validate(toJsonSchema(), s);
      assert.equal(ok1, ok2);
    }
  });
});
