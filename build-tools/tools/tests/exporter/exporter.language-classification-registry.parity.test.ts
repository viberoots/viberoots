#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { languageClassificationEntry } from "../../buck/exporter/lang/classification-registry";
import { isRuleType, validateLanguageClassification } from "../../buck/exporter/lang/helpers";
import type { Node } from "../../buck/exporter/types";

function findingsFor(nodes: Node[], entryName: "go" | "cpp" | "node" | "python"): string[] {
  const entry = languageClassificationEntry(entryName);
  return validateLanguageClassification(nodes, {
    name: entry.name,
    looksLike: entry.looksLike,
    hasRuleType(node) {
      return entry.ruleTypePatterns.some((pattern) => isRuleType(node, pattern));
    },
    hasLangLabel(node) {
      return node.labels?.includes(entry.langLabel) ?? false;
    },
    ruleTypePrefix: entry.ruleTypePrefixLabel,
    langLabel: entry.langLabel,
    subject: entry.subject,
    guidance: entry.guidance,
  });
}

test("language classification registry preserves validation wording", () => {
  {
    const out = findingsFor(
      [{ name: "//build-tools/go/app:bin", srcs: ["build-tools/go/app/main.go"] }],
      "go",
    );
    assert.equal(out.length, 1);
    assert.match(
      out[0],
      /\[exporter\]\[go\] targets include \.go sources but lack both go_\* rule_type and 'lang:go' label:/,
    );
    assert.match(out[0], /Fix: ensure macros stamp 'lang:go'/);
  }

  {
    const out = findingsFor(
      [{ name: "//build-tools/cpp/app:bin", srcs: ["build-tools/cpp/app/main.cpp"] }],
      "cpp",
    );
    assert.equal(out.length, 1);
    assert.match(
      out[0],
      /\[exporter\]\[cpp\] targets include C\+\+-looking sources but lack both cxx_\* rule_type and 'lang:cpp' label:/,
    );
    assert.match(out[0], /Guidance: stamp 'lang:cpp' in macros or use cxx_\* rules/i);
  }

  {
    const out = findingsFor(
      [
        {
          name: "//projects/apps/web:bundle",
          labels: ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],
        },
      ],
      "node",
    );
    assert.equal(out.length, 1);
    assert.match(
      out[0],
      /\[exporter\]\[node\] targets include macro-stamped Node targets but lack both js_\* or node_\* rule_type and 'lang:node' label:/,
    );
    assert.match(out[0], /Fix: ensure macros stamp 'lang:node'/);
  }

  {
    const out = findingsFor(
      [{ name: "//projects/apps/pytool:bin", srcs: ["projects/apps/pytool/main.py"] }],
      "python",
    );
    assert.equal(out.length, 1);
    assert.match(
      out[0],
      /\[exporter\]\[python\] targets include Python-looking sources but lack both python_\* rule_type and 'lang:python' label:/,
    );
    assert.match(out[0], /Guidance: stamp 'lang:python'/);
  }
});
