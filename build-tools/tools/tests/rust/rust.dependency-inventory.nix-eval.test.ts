#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("Rust dependency inventory preserves stable source identities and sorted edges", async () => {
  await runInTemp("rust-dependency-inventory", async (tmp, $) => {
    await fs.writeFile(
      path.join(tmp, "Cargo.lock"),
      `version = 3
[[package]]
name = "root"
version = "0.1.0"
dependencies = ["z 1.0.0", "a 2.0.0"]
[[package]]
name = "registry"
version = "1.2.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"
`,
    );
    const expression = `import ./viberoots/build-tools/tools/nix/templates/rust-dependency-inventory.nix {
      cargoLock = ${JSON.stringify(path.join(tmp, "Cargo.lock"))};
    }`;
    const result = await $({ cwd: tmp, stdio: "pipe" })`
      nix eval --impure --json --expr ${expression}
    `;
    const inventory = JSON.parse(String(result.stdout));
    const root = inventory.find((entry: { name: string }) => entry.name === "root");
    const registry = inventory.find((entry: { name: string }) => entry.name === "registry");
    assert.deepEqual(root, {
      checksum: "",
      dependencies: ["a 2.0.0", "z 1.0.0"],
      name: "root",
      source: "workspace",
      version: "0.1.0",
    });
    assert.equal(registry.source, "registry+https://github.com/rust-lang/crates.io-index");
    assert.equal(registry.checksum, "abc");
  });
});
