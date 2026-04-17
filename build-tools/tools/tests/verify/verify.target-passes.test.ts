#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { planVerifyTargetPasses, VERIFY_ISOLATED_LABEL } from "../../dev/verify/target-passes.ts";

test("verify target passes isolate labeled targets ahead of the shared batch", () => {
  const passes = planVerifyTargetPasses([
    { target: "//projects/apps/pleomino:pr14_latency", labels: [VERIFY_ISOLATED_LABEL] },
    { target: "//projects/apps/pleomino:unit", labels: ["kind:test"] },
    {
      target: "//:scaffolding_webapp_ssr_next_contracts",
      labels: ["kind:test", VERIFY_ISOLATED_LABEL],
    },
  ]);

  assert.deepEqual(passes, [
    {
      name: "isolated://projects/apps/pleomino:pr14_latency",
      targets: ["//projects/apps/pleomino:pr14_latency"],
      threadsOverride: 1,
    },
    {
      name: "isolated://:scaffolding_webapp_ssr_next_contracts",
      targets: ["//:scaffolding_webapp_ssr_next_contracts"],
      threadsOverride: 1,
    },
    {
      name: "shared",
      targets: ["//projects/apps/pleomino:unit"],
    },
  ]);
});
