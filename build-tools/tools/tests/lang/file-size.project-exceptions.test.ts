#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { SOURCE_FILES_SCOPE, findFileSizeOffenders } from "../../dev/file-size-lint";
import {
  PROJECT_METHODOLOGY_EXCEPTIONS_FILENAME,
  resolveSourceFileSizeExceptionPaths,
} from "../../dev/file-size-lint-exceptions.ts";
import { runInTemp } from "../lib/test-helpers.ts";

function oversizedModule(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `export const line${index} = ${index};`).join(
    "\n",
  );
}

test("project-local file-size exceptions stay scoped to the owning project", async () => {
  await runInTemp("file-size-project-exceptions", async (tmp, $) => {
    const pleominoRoot = path.join(tmp, "projects/apps/pleomino");
    const otherRoot = path.join(tmp, "projects/apps/other");
    const pleominoSource = "src/generated/oversized.ts";
    const otherSource = "src/generated/oversized.ts";

    await fsp.mkdir(path.join(pleominoRoot, "src/generated"), { recursive: true });
    await fsp.mkdir(path.join(otherRoot, "src/generated"), { recursive: true });
    await fsp.writeFile(
      path.join(pleominoRoot, PROJECT_METHODOLOGY_EXCEPTIONS_FILENAME),
      JSON.stringify(
        {
          sourceFileSizeExceptions: [
            {
              path: pleominoSource,
              justification: "Generated fixture owned by Pleomino.",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(path.join(pleominoRoot, pleominoSource), oversizedModule(260), "utf8");
    await fsp.writeFile(path.join(otherRoot, otherSource), oversizedModule(260), "utf8");
    await $`git add ${path.join(pleominoRoot, PROJECT_METHODOLOGY_EXCEPTIONS_FILENAME)} ${path.join(
      pleominoRoot,
      pleominoSource,
    )} ${path.join(otherRoot, otherSource)}`;

    const exceptions = await resolveSourceFileSizeExceptionPaths(tmp);
    assert.deepEqual(exceptions, ["projects/apps/pleomino/src/generated/oversized.ts"]);

    const offenders = await findFileSizeOffenders({
      root: tmp,
      changedOnly: false,
      threshold: 250,
      failOnOffenders: true,
      allowKnown: false,
      scope: SOURCE_FILES_SCOPE,
    });

    assert.deepEqual(
      offenders.map((offender) => offender.file),
      ["projects/apps/other/src/generated/oversized.ts"],
    );
  });
});
