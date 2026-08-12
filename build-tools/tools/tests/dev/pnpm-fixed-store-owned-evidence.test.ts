import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type OwnedPathInfo,
  parseOwnedPathInfo,
  verifyOwnedRegistrationWindow,
} from "./pnpm-fixed-store-owned-evidence";

const drv = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-owned.drv";
const out = "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-owned";
const leaked = "/nix/store/cccccccccccccccccccccccccccccccc-owned";

function record(overrides: Partial<OwnedPathInfo> = {}): OwnedPathInfo {
  return {
    closureSize: 1024,
    narSize: 1024,
    references: [],
    registrationTime: 100,
    ...overrides,
  };
}

test("owned path-info parsing fails closed on malformed references", () => {
  const base = {
    closureSize: 1024,
    narSize: 1024,
    path: out,
    registrationTime: 100,
  };
  for (const malformed of [
    base,
    { ...base, references: out },
    { ...base, references: [out, 42] },
  ]) {
    assert.throws(
      () => parseOwnedPathInfo(JSON.stringify([malformed])),
      /invalid owned path-info record/,
    );
  }
  assert.deepEqual(
    parseOwnedPathInfo(JSON.stringify([{ ...base, references: [] }])).get(out)?.references,
    [],
  );
});

test("owned registration evidence rejects runtime references and unexpected outputs", () => {
  assert.throws(
    () =>
      verifyOwnedRegistrationWindow({
        authorityRecords: new Map([
          [drv, record()],
          [out, record({ references: [leaked] })],
        ]),
        exactCreatedRecords: new Map([[out, record()]]),
        exactCreatedPaths: [out],
        markerDerivation: drv,
        markerOutput: out,
        maxKib: 1024,
        registrationStartedAt: 99,
      }),
    /retained references/,
  );
  assert.throws(
    () =>
      verifyOwnedRegistrationWindow({
        authorityRecords: new Map([
          [drv, record()],
          [out, record()],
        ]),
        exactCreatedRecords: new Map([[leaked, record()]]),
        exactCreatedPaths: [leaked],
        markerDerivation: drv,
        markerOutput: out,
        maxKib: 1024,
        registrationStartedAt: 99,
      }),
    /unexpected unreferenced owned pnpm paths/,
  );
});

test("owned registration evidence bounds paths created inside the authority window", () => {
  assert.throws(
    () =>
      verifyOwnedRegistrationWindow({
        authorityRecords: new Map([
          [drv, record({ narSize: 800 * 1024 })],
          [out, record({ narSize: 400 * 1024, closureSize: 400 * 1024 })],
        ]),
        exactCreatedRecords: new Map([[out, record({ narSize: 400 * 1024 })]]),
        exactCreatedPaths: [out],
        markerDerivation: drv,
        markerOutput: out,
        maxKib: 1024,
        registrationStartedAt: 99,
      }),
    /registration exceeded 1024KiB guard/,
  );
});
