#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  computeFingerprintMap,
  mapsEqual,
  membershipMapsEqual,
} from "../../dev/watch-wasm-producer-ops";

test("wasm watch fingerprints separate content from source membership", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-wasm-membership-"));
  t.after(async () => await fsp.rm(root, { recursive: true, force: true }));

  const watched = path.join(root, "watched");
  await fsp.mkdir(watched);
  await fsp.writeFile(path.join(watched, "a.txt"), "a", "utf8");
  const initial = await computeFingerprintMap([watched]);

  await fsp.writeFile(path.join(watched, "a.txt"), "content-change", "utf8");
  const contentChanged = await computeFingerprintMap([watched]);
  assert.equal(membershipMapsEqual(initial, contentChanged), true);
  assert.equal(mapsEqual(initial, contentChanged), false);

  await fsp.rename(path.join(watched, "a.txt"), path.join(watched, "b.txt"));
  const renamed = await computeFingerprintMap([watched]);
  assert.equal(membershipMapsEqual(contentChanged, renamed), false);

  const firstOrder = path.join(root, "first-order");
  const secondOrder = path.join(root, "second-order");
  await fsp.mkdir(firstOrder);
  await fsp.mkdir(secondOrder);
  await fsp.writeFile(path.join(firstOrder, "a"), "", "utf8");
  await fsp.writeFile(path.join(firstOrder, "b"), "", "utf8");
  await fsp.writeFile(path.join(secondOrder, "b"), "", "utf8");
  await fsp.writeFile(path.join(secondOrder, "a"), "", "utf8");
  const firstMembership = (await computeFingerprintMap([firstOrder])).get(firstOrder)?.membership;
  const secondMembership = (await computeFingerprintMap([secondOrder])).get(
    secondOrder,
  )?.membership;
  assert.equal(firstMembership, secondMembership);

  const transition = path.join(root, "transition");
  const missing = await computeFingerprintMap([transition]);
  await fsp.writeFile(transition, "file", "utf8");
  const file = await computeFingerprintMap([transition]);
  assert.equal(membershipMapsEqual(missing, file), false);
  await fsp.rm(transition);
  await fsp.mkdir(transition);
  const directory = await computeFingerprintMap([transition]);
  assert.equal(membershipMapsEqual(file, directory), false);
});
