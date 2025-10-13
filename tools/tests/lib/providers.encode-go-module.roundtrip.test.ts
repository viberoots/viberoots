#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { decodeFromPatchFilename, encodeForPatchFilename } from "../../lib/providers";

test("go module path encode/decode roundtrip", async () => {
  const cases = ["golang.org/x/net", "github.com/sirupsen/logrus", "github.com/stretchr/testify"];
  for (const c of cases) {
    const enc = encodeForPatchFilename(c);
    if (!enc.includes("__")) {
      console.error("expected __ in encoding for", c, enc);
      process.exit(2);
    }
    const dec = decodeFromPatchFilename(enc);
    if (dec.toLowerCase() !== c.toLowerCase()) {
      console.error("bad roundtrip for", c, enc, dec);
      process.exit(2);
    }
  }
});
