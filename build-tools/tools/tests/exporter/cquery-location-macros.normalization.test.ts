import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nodesFromCqueryJson,
  normalizeLocationMacrosForOwner,
} from "../../buck/exporter/cquery/nodes";

test("cquery command normalization removes configured suffixes from Buck location macros", () => {
  const command = [
    'cp "$(location root//projects/libs/demo:lib (prelude//platforms:default#abc))" "$OUT"',
    'printf "%s" "$(dirname "$OUT")"',
    'cp "$(location :sibling (root//:no_cgo#def))" "$OUT.sibling"',
  ].join("; ");

  assert.equal(
    normalizeLocationMacrosForOwner("//projects/apps/demo:app", command),
    [
      'cp "$(location //projects/libs/demo:lib)" "$OUT"',
      'printf "%s" "$(dirname "$OUT")"',
      'cp "$(location //projects/apps/demo:sibling)" "$OUT.sibling"',
    ].join("; "),
  );
});

test("cquery source normalization preserves files and normalizes target sources", () => {
  const [node] = nodesFromCqueryJson({
    "root//projects/apps/demo:app (prelude//platforms:default#abc)": {
      rule_type: "genrule",
      srcs: [
        "src/index.ts",
        ":generated (prelude//platforms:default#abc)",
        "root//projects/libs/wasm:module (prelude//platforms:default#abc)",
      ],
    },
  });
  assert.deepEqual(node?.srcs, [
    "src/index.ts",
    "//projects/apps/demo:generated",
    "//projects/libs/wasm:module",
  ]);
});

test("cquery node conversion applies location normalization to exported commands", () => {
  const [node] = nodesFromCqueryJson({
    "root//projects/apps/demo:app (prelude//platforms:default#abc)": {
      rule_type: "genrule",
      cmd: 'cp "$(location root//projects/libs/demo:lib (root//:platform#def))" "$OUT"',
    },
  });

  assert.equal(node?.name, "//projects/apps/demo:app");
  assert.equal(node?.cmd, 'cp "$(location //projects/libs/demo:lib)" "$OUT"');
});
