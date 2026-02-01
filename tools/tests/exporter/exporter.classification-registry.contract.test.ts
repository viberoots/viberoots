#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { classificationRegistryEntry } from "../../buck/exporter/lang/classification-registry.ts";

test("language classification registry is stable contract data", () => {
  const go = classificationRegistryEntry("go");
  assert.equal(go.ruleTypePrefix, "go_*");
  assert.equal(go.langLabel, "lang:go");
  assert.equal(go.subject, ".go sources");
  assert.equal(
    go.guidance,
    "Fix: ensure macros stamp 'lang:go' (and 'kind:bin') or use go_* rules.",
  );
  assert.equal(go.looksLike({ name: "//mod:bin", srcs: ["main.go"] } as any), true);
  assert.equal(go.hasRuleType({ rule_type: "go_library" } as any), true);
  assert.equal(go.hasLangLabel({ labels: ["lang:go"] } as any), true);

  const cpp = classificationRegistryEntry("cpp");
  assert.equal(cpp.ruleTypePrefix, "cxx_*");
  assert.equal(cpp.langLabel, "lang:cpp");
  assert.equal(cpp.subject, "C++-looking sources");
  assert.equal(
    cpp.guidance,
    "Guidance: stamp 'lang:cpp' in macros or use cxx_* rules to classify C++ targets.",
  );
  assert.equal(cpp.looksLike({ name: "//cpp:bin", srcs: ["main.cpp"] } as any), true);
  assert.equal(cpp.hasRuleType({ rule_type: "cxx_binary" } as any), true);
  assert.equal(cpp.hasLangLabel({ labels: ["lang:cpp"] } as any), true);

  const node = classificationRegistryEntry("node");
  assert.equal(node.ruleTypePrefix, "js_* or node_*");
  assert.equal(node.langLabel, "lang:node");
  assert.equal(node.subject, "macro-stamped Node targets");
  assert.equal(
    node.guidance,
    "Fix: ensure macros stamp 'lang:node' to classify Node targets consistently.",
  );
  assert.equal(
    node.looksLike({
      name: "//apps/web:bundle",
      labels: ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],
    } as any),
    true,
  );
  assert.equal(node.hasRuleType({ rule_type: "js_library" } as any), true);
  assert.equal(node.hasLangLabel({ labels: ["lang:node"] } as any), true);

  const python = classificationRegistryEntry("python");
  assert.equal(python.ruleTypePrefix, "python_*");
  assert.equal(python.langLabel, "lang:python");
  assert.equal(python.subject, "Python-looking sources");
  assert.equal(
    python.guidance,
    "Guidance: stamp 'lang:python' via macros or use python_* rules to classify Python targets.",
  );
  assert.equal(python.looksLike({ name: "//py:lib", srcs: ["main.py"] } as any), true);
  assert.equal(python.hasRuleType({ rule_type: "python_library" } as any), true);
  assert.equal(python.hasLangLabel({ labels: ["lang:python"] } as any), true);
});
