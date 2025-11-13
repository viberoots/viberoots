#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels";

test("normalizeTargetLabel drops (config//...) and cell prefixes", async () => {
  const samples: Array<{ in: string; out: string }> = [
    {
      in: "root//apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerlang/cxx)",
      out: "//apps/foo:svc",
    },
    {
      in: "//apps/foo:svc (config//buck:some)",
      out: "//apps/foo:svc",
    },
    {
      in: "prelude//cpp:lib (config//toolchains:xyz)",
      out: "//cpp:lib",
    },
    {
      in: "root//libs/helper:lib",
      out: "//libs/helper:lib",
    },
  ];
  for (const s of samples) {
    const got = normalizeTargetLabel(s.in);
    if (got !== s.out) {
      console.error("normalizeTargetLabel mismatch:", { in: s.in, got, want: s.out });
      process.exit(2);
    }
  }
});
