#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels";

test("normalizeTargetLabel drops (config//...) and cell prefixes", async () => {
  const samples: Array<{ in: string; out: string }> = [
    {
      in: "root//projects/apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerbuild-tools/lang/cxx)",
      out: "//projects/apps/foo:svc",
    },
    {
      in: "//third_party/providers:prov (root//:no_cgo#6eb543497f051f11)",
      out: "//third_party/providers:prov",
    },
    {
      in: "//projects/apps/foo:svc (config//buck:some)",
      out: "//projects/apps/foo:svc",
    },
    {
      in: "prelude//build-tools/cpp:lib (config//toolchains:xyz)",
      out: "//build-tools/cpp:lib",
    },
    {
      in: "root//projects/libs/helper:lib",
      out: "//projects/libs/helper:lib",
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
