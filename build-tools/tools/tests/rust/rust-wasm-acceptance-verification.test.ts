import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseNixStoreRuntimeIdentity,
  stableNixStoreQueryEnv,
} from "./rust-wasm-acceptance-verification";

const output = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-runtime";
const reference = "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-runner";

test("stable nix-store runtime evidence preserves direct references and exact closure bytes", () => {
  assert.deepEqual(
    parseNixStoreRuntimeIdentity(
      output,
      `${reference}\n`,
      `${reference}\n${output}\n`,
      "1024\n2048\n",
    ),
    {
      closureSize: 3072,
      references: [reference],
    },
  );
  assert.throws(
    () => parseNixStoreRuntimeIdentity(output, "", `${reference}\n`, "1024\n"),
    /omitted/,
  );
  assert.throws(
    () => parseNixStoreRuntimeIdentity(output, "", `${output}\n`, "not-a-size\n"),
    /invalid nix-store closure-size evidence/,
  );
});

test("stable nix-store queries do not inherit ambient experimental-feature configuration", () => {
  const ambient = {
    NIX_CONFIG: "experimental-features = nix-command flakes",
    PRESERVED: "yes",
  };
  assert.deepEqual(stableNixStoreQueryEnv(ambient), {
    NIX_CONFIG: "",
    PRESERVED: "yes",
  });
  assert.equal(ambient.NIX_CONFIG, "experimental-features = nix-command flakes");
});
