#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_KIND_VALUES,
  isAllowedKindLabel,
  isAllowedKindValue,
} from "../../lib/kind-vocabulary";

test("kind vocabulary (TS): accepts allowed kinds used in the repo", () => {
  for (const k of ALLOWED_KIND_VALUES) {
    assert.equal(isAllowedKindValue(k), true, `expected allowed kind value: ${k}`);
    assert.equal(isAllowedKindLabel(`kind:${k}`), true, `expected allowed kind label: kind:${k}`);
  }
});

test("kind vocabulary (TS): rejects invalid kind labels and values", () => {
  assert.equal(isAllowedKindValue(""), false);
  assert.equal(isAllowedKindValue("not-a-kind"), false);
  assert.equal(isAllowedKindLabel("kind:"), false);
  assert.equal(isAllowedKindLabel("kind:not-a-kind"), false);
  assert.equal(isAllowedKindLabel("lang:go"), false);
});
