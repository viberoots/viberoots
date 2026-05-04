#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeFromPatchFilename,
  decodeFromPatchFilenameLoose,
  decodeNameVersionFromPatch,
  decodeNameVersionFromPatchLoose,
  encodeForPatchFilename,
} from "../../lib/providers";

test("patch filename encoding/decoding policy (strict vs loose)", async () => {
  assert.equal(encodeForPatchFilename("golang.org/x/net"), "golang.org__x__net");
  assert.equal(decodeFromPatchFilename("golang.org__x__net"), "golang.org/x/net");

  // Strict decode matches Nix semantics: "__" -> "/".
  // This must remain lossless for names that include underscores adjacent to separators.
  assert.equal(decodeFromPatchFilename("lodash___core"), "lodash/_core");

  // Loose decode exists only for patches-lint to exercise duplicate detection on
  // case-insensitive filesystems (e.g., treat double-slashes as one slash).
  assert.equal(decodeFromPatchFilename("github.com____acme__widget"), "github.com//acme/widget");
  assert.equal(
    decodeFromPatchFilenameLoose("github.com____acme__widget"),
    "github.com/acme/widget",
  );
});

test("patch filename key decoding uses last-@ and lowercases", async () => {
  assert.equal(decodeNameVersionFromPatch("@scope__pkg@1.2.3.patch"), "@scope/pkg@1.2.3");
  assert.equal(decodeNameVersionFromPatch("foo@bar@1.0.0.patch"), "foo@bar@1.0.0");
  assert.equal(decodeNameVersionFromPatch("PKGS__OPENSSL@3.2.0.patch"), "pkgs/openssl@3.2.0");
  assert.equal(decodeNameVersionFromPatch("bad@.patch"), null);
  assert.equal(decodeNameVersionFromPatch("not-a-patch.txt"), null);

  // Loose variant stays consistent with strict for canonical filenames.
  assert.equal(
    decodeNameVersionFromPatchLoose("@scope__pkg@1.2.3.patch"),
    decodeNameVersionFromPatch("@scope__pkg@1.2.3.patch"),
  );
});
