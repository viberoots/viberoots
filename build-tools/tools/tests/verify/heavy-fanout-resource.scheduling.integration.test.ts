#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { killBuckIsolation } from "../../dev/verify/process-control";
import { mktemp, testOwnedBuckIsolation } from "../lib/test-helpers";

type Interval = { start: number; end: number };
const inheritedProbeIsolation = testOwnedBuckIsolation("heavy-fanout-inherited-probe");
const schedulingIsolation = testOwnedBuckIsolation("heavy-fanout-scheduling", {
  ...process.env,
  BUCK_NESTED_ISO: inheritedProbeIsolation,
});

after(async () => await killBuckIsolation(process.cwd(), schedulingIsolation));
after(async () => await killBuckIsolation(process.cwd(), inheritedProbeIsolation));

async function readInterval(root: string, name: string): Promise<Interval> {
  return JSON.parse(await fsp.readFile(path.join(root, `${name}.json`), "utf8")) as Interval;
}

function overlaps(a: Interval, b: Interval): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

async function daemonId(isolation: string): Promise<string> {
  const started =
    await $`buck2 --isolation-dir ${isolation} targets viberoots//:verify_verify_progress_line`
      .nothrow()
      .quiet();
  assert.equal(started.exitCode, 0, `${started.stdout}\n${started.stderr}`);
  const status = await $`buck2 --isolation-dir ${isolation} status`.nothrow().quiet();
  assert.equal(status.exitCode, 0, `${status.stdout}\n${status.stderr}`);
  return String(JSON.parse(String(status.stdout)).daemon_constraints?.daemon_id || "");
}

test("test-owned scheduling cleanup never kills an inherited daemon", async () => {
  assert.notEqual(schedulingIsolation, inheritedProbeIsolation);
  assert.notEqual(schedulingIsolation, process.env.BUCK_NESTED_ISO);
  const inheritedDaemon = await daemonId(inheritedProbeIsolation);
  assert.ok(inheritedDaemon);
  assert.ok(await daemonId(schedulingIsolation));
  await killBuckIsolation(process.cwd(), schedulingIsolation);
  assert.equal(await daemonId(inheritedProbeIsolation), inheritedDaemon);
});

test("heavy-fanout pool serializes heavy tests without consuming the ordinary worker", async () => {
  const markerDir = await mktemp("heavy-fanout-markers-");
  try {
    const targets = [
      "viberoots//build-tools/tools/tests/fixtures/heavy-fanout-resource:heavy_one",
      "viberoots//build-tools/tools/tests/fixtures/heavy-fanout-resource:heavy_two",
      "viberoots//build-tools/tools/tests/fixtures/heavy-fanout-resource:ordinary",
    ];
    const result =
      await $`buck2 --isolation-dir ${schedulingIsolation} test --local-only --no-remote-cache --target-platforms prelude//platforms:default --num-threads 2 ${targets} -- --env ${`VBR_HEAVY_FANOUT_MARKER_DIR=${markerDir}`} --env VBR_NIX_CACHE_POLICY=off --timeout 60`
        .nothrow()
        .quiet();
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);

    const heavyOne = await readInterval(markerDir, "heavy-one");
    const heavyTwo = await readInterval(markerDir, "heavy-two");
    const ordinary = await readInterval(markerDir, "ordinary");
    assert.equal(overlaps(heavyOne, heavyTwo), false, "heavy intervals must never overlap");
    assert.equal(
      overlaps(ordinary, heavyOne) || overlaps(ordinary, heavyTwo),
      true,
      "ordinary work must overlap one heavy interval",
    );
  } finally {
    await fsp.rm(markerDir, { recursive: true, force: true });
  }
});
