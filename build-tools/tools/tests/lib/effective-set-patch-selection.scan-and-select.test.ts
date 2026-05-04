#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";
import {
  scanFlatPatchDirToLowercaseKeyToPatchPathMap,
  selectPatchPathsForEffectiveSet,
} from "../../lib/effective-set-patch-selection";

test("effective set patch selection: scan builds a lowercase key map and selection is stable/deduped", async () => {
  await runInTemp("effective-set-patch-selection", async (tmp, _$) => {
    const patchDir = path.join(tmp, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    const fooPath = path.join(patchDir, "Foo@1.0.0.patch");
    const barPath = path.join(patchDir, "Bar@2.0.0.patch");
    await fsp.writeFile(fooPath, "# patch\n", "utf8");
    await fsp.writeFile(barPath, "# patch\n", "utf8");

    const decodeKey = (filename: string): string | null =>
      filename.endsWith(".patch") ? filename.slice(0, -".patch".length) : null;

    const keyToPatchPath = await scanFlatPatchDirToLowercaseKeyToPatchPathMap({
      patchDir,
      decodeKey,
    });

    assert.equal(keyToPatchPath.get("foo@1.0.0"), fooPath.replace(/\\/g, "/"));
    assert.equal(keyToPatchPath.get("bar@2.0.0"), barPath.replace(/\\/g, "/"));

    const selected = selectPatchPathsForEffectiveSet({
      effectiveSet: ["BAR@2.0.0", "missing@0.0.0", "Foo@1.0.0"],
      keyToPatchPath,
    });
    assert.deepEqual(selected, [barPath.replace(/\\/g, "/"), fooPath.replace(/\\/g, "/")]);

    const deduped = selectPatchPathsForEffectiveSet({
      effectiveSet: ["Dupe@1.0.0", "Dupe2@1.0.0"],
      keyToPatchPath: new Map([
        ["dupe@1.0.0", fooPath.replace(/\\/g, "/")],
        ["dupe2@1.0.0", fooPath.replace(/\\/g, "/")],
      ]),
    });
    assert.deepEqual(deduped, [fooPath.replace(/\\/g, "/")]);
  });
});
