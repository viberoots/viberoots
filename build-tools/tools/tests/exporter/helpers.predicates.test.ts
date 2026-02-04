#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("hasLabel and isRuleType work for simple cases", async () => {
  const { hasLabel, isRuleType } = await import("../../buck/exporter/lang/helpers.ts");
  const node = { name: "//pkg:lib", rule_type: "go_library", labels: ["lang:go", "kind:lib"] };
  assert.ok(hasLabel(node as any, "lang:go"));
  assert.ok(isRuleType(node as any, "go_"));
  assert.ok(isRuleType(node as any, /^go_/));
  assert.equal(hasLabel(node as any, "lang:ts"), false);
  assert.equal(isRuleType(node as any, "cxx_"), false);
});
