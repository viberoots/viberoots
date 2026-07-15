import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { planVerifyTargetPasses, VERIFY_ISOLATED_LABEL } from "../../dev/verify/target-passes";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const files = [
  "build-tools/tools/tests/viberoots/fresh-clone-post-clone.test.ts",
  "build-tools/tools/tests/viberoots/fresh-clone-post-clone-fail-closed.test.ts",
  "build-tools/tools/tests/viberoots/fresh-clone-post-clone-pnpm-stale.test.ts",
] as const;

test("copy-heavy fresh-clone tests use one serial isolated pass", async () => {
  const taxonomy = await fsp.readFile(
    path.join(VIBEROOTS_SOURCE_ROOT, "build-tools/tools/tests/isolated_test_conventions.bzl"),
    "utf8",
  );
  for (const file of files) assert.match(taxonomy, new RegExp(`${JSON.stringify(file)}: True`));

  const targets = files.map((file) => ({ target: `//:${file}`, labels: [VERIFY_ISOLATED_LABEL] }));
  assert.deepEqual(planVerifyTargetPasses(targets), [
    {
      name: "isolated",
      targets: targets.map(({ target }) => target),
      threadsOverride: 1,
    },
  ]);
});
