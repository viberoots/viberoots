#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseVerifyOwnedState } from "../../dev/verify/owned-process-state";
import { forkserversUnderRepo } from "./test-helpers/buck-procs";
import { inheritedBuckIsolation, runInTemp } from "./test-helpers";

test("buck cleanup: uninterrupted runInTemp does not leave buck2 daemons behind", async () => {
  // If runInTemp fails to terminate buck2 daemons before deleting the temp repo,
  // it now throws from its cleanup block and this test will fail.
  await runInTemp("buck-cleanup-uninterrupted", async (_tmp, $) => {
    await $`buck2 build //.viberoots/workspace:flake.lock`;
  });
});

test("buck cleanup: explicit inherited isolation is registered and cleaned", async () => {
  const prevState = process.env.VBR_VERIFY_PROCESS_STATE_FILE;
  const stateFile = path.join(
    os.tmpdir(),
    `viberoots-inherited-buck-cleanup-${process.pid}-${Date.now()}.txt`,
  );
  let tmpRoot = "";
  let explicitIso = "";

  try {
    process.env.VBR_VERIFY_PROCESS_STATE_FILE = stateFile;
    await fsp.writeFile(stateFile, "", "utf8");

    await runInTemp("buck-cleanup-inherited-explicit", async (tmp, $) => {
      tmpRoot = tmp;
      explicitIso = inheritedBuckIsolation("buck_cleanup_inherited_explicit");
      await $`buck2 --isolation-dir ${inheritedBuckIsolation("buck_cleanup_inherited_explicit")} build //.viberoots/workspace:flake.lock`;

      const parsed = parseVerifyOwnedState(await fsp.readFile(stateFile, "utf8"));
      const registered = parsed.isolations.find(
        (entry) =>
          entry.kind === "run-in-temp-zxtest" &&
          entry.repoRoot === path.resolve(tmp) &&
          entry.iso === explicitIso,
      );
      if (!registered) {
        throw new Error(`expected inherited isolation to be registered: ${explicitIso}`);
      }
    });

    const offenders = await forkserversUnderRepo(tmpRoot, $);
    if (offenders.length > 0) {
      throw new Error(
        `buck cleanup: inherited-isolation forkservers remained:\n${offenders
          .map((offender) => `${offender.pid} ${offender.ppid} ${offender.cmd}`)
          .join("\n")}`,
      );
    }
  } finally {
    if (prevState === undefined) delete process.env.VBR_VERIFY_PROCESS_STATE_FILE;
    else process.env.VBR_VERIFY_PROCESS_STATE_FILE = prevState;
    await fsp.rm(stateFile, { force: true }).catch(() => {});
  }
});
