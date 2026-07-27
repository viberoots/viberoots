import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function assertStableInteropGenerator(
  $: typeof import("zx").$,
  generator: string,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rust-interop-bindings-"));
  try {
    const config = path.join(root, "bindings.json");
    await fs.writeFile(
      config,
      `${JSON.stringify({
        schema: "viberoots.rust-interop.v1",
        namespace: "demo",
        functions: [
          {
            name: "rust_apply",
            return: "i32",
            callback_error_value: -1,
            params: [
              { name: "callback", type: "callback_i32" },
              { name: "context", type: "mut_void_ptr" },
            ],
          },
          {
            name: "rust_destroy",
            return: "void",
            params: [{ name: "value", type: "mut_void_ptr" }],
          },
        ],
      })}\n`,
    );
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await $`${process.execPath} ${generator} ${config} ${first} demo_bridge cxx contained abort caller send-sync c++17`;
    await $`${process.execPath} ${generator} ${config} ${second} demo_bridge cxx contained abort caller send-sync c++17`;
    for (const file of [
      "demo_bridge.h",
      "demo_bridge.hpp",
      "demo_bridge.cc",
      "demo_bridge.rs",
      "manifest.json",
    ]) {
      assert.deepEqual(
        await fs.readFile(path.join(first, file)),
        await fs.readFile(path.join(second, file)),
      );
    }
    assert.match(await fs.readFile(path.join(first, "demo_bridge.h"), "utf8"), /rust_destroy/);
    assert.match(await fs.readFile(path.join(first, "demo_bridge.hpp"), "utf8"), /namespace demo/);
    assert.match(
      await fs.readFile(path.join(first, "manifest.json"), "utf8"),
      /"cxxStandard": "c\+\+17"/,
    );
    const changed = path.join(root, "changed");
    const changedConfig = JSON.parse(await fs.readFile(config, "utf8"));
    changedConfig.functions.push({ name: "rust_status", return: "i32", params: [] });
    await fs.writeFile(config, `${JSON.stringify(changedConfig)}\n`);
    await $({ env: { ...process.env, PATH: "/hostile" } })`
      ${process.execPath} ${generator} ${config} ${changed} demo_bridge cxx contained abort caller send-sync c++17
    `;
    assert.notDeepEqual(
      await fs.readFile(path.join(first, "demo_bridge.h")),
      await fs.readFile(path.join(changed, "demo_bridge.h")),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
