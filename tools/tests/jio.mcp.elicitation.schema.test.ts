import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildElicitControl,
  buildElicitResponseControl,
  isControl,
  isElicit,
  sanitizeControlString,
  validateRequestedSchemaBestEffort,
} from "../jio/mcp/elicitation.ts";

test("requested schema: simple object valid", () => {
  const schema = {
    type: "object",
    properties: { confirm: { type: "boolean" } },
    required: ["confirm"],
    additionalProperties: false,
  };
  const reasons = validateRequestedSchemaBestEffort(schema);
  assert.equal(reasons.length, 0);
});

test("requested schema: unsupported features flagged", () => {
  const schema = { anyOf: [{ type: "string" }, { type: "number" }] };
  const reasons = validateRequestedSchemaBestEffort(schema);
  assert.ok(reasons.length >= 1);
});

test("build and detect control messages", () => {
  const ctl = buildElicitControl("msg", { type: "object", properties: {} });
  assert.equal(isControl(ctl), true);
  assert.equal(isElicit(ctl), true);
  const resp = buildElicitResponseControl({ action: "accept", content: { ok: true } } as any);
  assert.equal(isControl(resp), true);
  assert.equal(isElicit(resp), false);
});

test("sanitize control string removes BOM and control chars", () => {
  const s = '\uFEFF\u0000{"a":1}\u200B';
  const t = sanitizeControlString(s);
  assert.equal(t.includes("\u0000"), false);
  assert.equal(t.includes("\u200B"), false);
});
