#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { encodeNixAttrForPatchPrefix, decodeNixAttrFromPatchPrefix } from "../../lib/providers";

test("nix attr encode/decode roundtrip", async () => {
  const cases = ["pkgs.zlib", "pkgs.openssl", "pkgs.gnome.glib"];
  for (const c of cases) {
    const enc = encodeNixAttrForPatchPrefix(c);
    if (!enc || !/^[A-Za-z0-9_]+(__[A-Za-z0-9_]+)*$/.test(enc)) {
      console.error("bad encoding for", c, enc);
      process.exit(2);
    }
    const dec = decodeNixAttrFromPatchPrefix(enc);
    if (dec !== c.toLowerCase()) {
      console.error("bad roundtrip for", c, enc, dec);
      process.exit(2);
    }
  }
});
