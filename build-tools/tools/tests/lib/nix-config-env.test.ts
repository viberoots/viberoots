#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sanitizeInheritedNixConfig,
  withSanitizedInheritedNixConfig,
} from "../../lib/nix-config-env";

test("sanitizeInheritedNixConfig removes unsupported inherited settings only", () => {
  const sanitized = sanitizeInheritedNixConfig(
    [
      "eval-cores = 8",
      "builders =",
      "substituters = https://cache.nixos.org",
      "lazy-trees = true",
      "warn-dirty = false",
    ].join("\n"),
  );

  assert.equal(
    sanitized,
    ["builders =", "substituters = https://cache.nixos.org", "warn-dirty = false"].join("\n"),
  );
});

test("withSanitizedInheritedNixConfig unsets empty sanitized config", () => {
  const env = withSanitizedInheritedNixConfig({
    NIX_CONFIG: ["eval-cores = 8", "lazy-trees = true"].join("\n"),
  });

  assert.equal(env.NIX_CONFIG, "warn-dirty = false");
  assert.match(env.NIX_CONF_DIR, /viberoots-empty-nix-conf$/);
});
