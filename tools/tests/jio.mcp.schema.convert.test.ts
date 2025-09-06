import { test } from "node:test";
import { jsonSchemaToZodSafe, scanUnsupportedFeatures } from "../jio/mcp/schema.ts";

function expectTruthy(v: any) {
  if (!v) throw new Error("expected truthy value");
}
function expectUndefined(v: any) {
  if (v !== undefined) throw new Error("expected undefined");
}
function expectGreaterThan(x: number, n: number) {
  if (!(x > n)) throw new Error(`expected ${x} > ${n}`);
}

test("converts simple object schema to zod", async () => {
  const schema = {
    type: "object",
    properties: { a: { type: "string" }, n: { type: "number", minimum: 1 } },
    required: ["a"],
    additionalProperties: false,
  };
  const res = await jsonSchemaToZodSafe(schema);
  expectTruthy(res.zod);
  expectUndefined(res.reasons);
});

test("flags unsupported features with reasons", async () => {
  const schema = {
    type: "object",
    anyOf: [{ type: "string" }, { type: "number" }],
  };
  const reasons = scanUnsupportedFeatures(schema);
  expectTruthy(reasons.find((r) => r.keyword.includes("anyOf")));
  const res = await jsonSchemaToZodSafe(schema);
  if (res.zod !== undefined) throw new Error("expected zod to be undefined");
  expectGreaterThan((res.reasons && res.reasons.length) || 0, 0);
});
