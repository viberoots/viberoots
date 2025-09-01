import { jsonSchemaToZodSafe, scanUnsupportedFeatures } from "../jio/mcp/schema.ts";

test("converts simple object schema to zod", async () => {
  const schema = {
    type: "object",
    properties: { a: { type: "string" }, n: { type: "number", minimum: 1 } },
    required: ["a"],
    additionalProperties: false,
  };
  const res = await jsonSchemaToZodSafe(schema);
  expect(res.zod).toBeTruthy();
  expect(res.reasons).toBeUndefined();
});

test("flags unsupported features with reasons", async () => {
  const schema = {
    type: "object",
    anyOf: [{ type: "string" }, { type: "number" }],
  };
  const reasons = scanUnsupportedFeatures(schema);
  expect(reasons.find((r) => r.keyword.includes("anyOf"))).toBeTruthy();
  const res = await jsonSchemaToZodSafe(schema);
  expect(res.zod).toBeUndefined();
  expect(res.reasons && res.reasons.length).toBeGreaterThan(0);
});
