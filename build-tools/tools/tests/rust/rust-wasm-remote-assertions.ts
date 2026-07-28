import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function parseBuckOutputs(
  stdout: string,
  cwd: string,
  labels: readonly string[],
): Map<string, string> {
  const outputs = new Map<string, string>();
  for (const line of stdout.trim().split(/\n+/)) {
    const fields = line.trim().split(/\s+/);
    const label = fields[0]?.replace(/^root(?=\/\/)/, "");
    const output = fields.at(-1);
    if (label && labels.includes(label) && output) {
      outputs.set(label, path.isAbsolute(output) ? output : path.join(cwd, output));
    }
  }
  return outputs;
}

export async function verifyDeclaredToolClosure(
  output: string,
  declaration: {
    schemaVersion?: string;
    manifest?: string;
    tools?: Array<{ key?: string; name?: string; executables?: string[] }>;
  },
): Promise<void> {
  assert.equal(declaration.schemaVersion, "viberoots.rust-wasm-tool-closure.v1");
  assert.equal(declaration.manifest, "share/viberoots-rust/wasm-manifest.json");
  const manifest = JSON.parse(await fs.readFile(path.join(output, declaration.manifest), "utf8"));
  assert.ok(declaration.tools?.length);
  for (const tool of declaration.tools) {
    assert.match(tool.key || "", /^[A-Za-z][A-Za-z0-9]*$/);
    assert.ok(tool.name);
    const storeRoot = manifest.tools?.[tool.key!];
    assert.match(storeRoot, /^\/nix\/store\//, `${tool.name} lacks a pinned store identity`);
    for (const executable of tool.executables || [])
      await fs.access(path.join(storeRoot, executable));
  }
}

export async function assertMaterializedTreeMatchesStore(
  materializedRoot: string,
  storeRoot: string,
): Promise<void> {
  const compare = async (relative: string): Promise<void> => {
    const materialized = path.join(materializedRoot, relative);
    const stored = path.join(storeRoot, relative);
    const [materializedStat, storedStat] = await Promise.all([
      fs.lstat(materialized),
      fs.lstat(stored),
    ]);
    assert.equal(materializedStat.isDirectory(), storedStat.isDirectory(), relative);
    assert.equal(materializedStat.isFile(), storedStat.isFile(), relative);
    assert.equal(materializedStat.isSymbolicLink(), storedStat.isSymbolicLink(), relative);
    if (materializedStat.isDirectory()) {
      const [materializedEntries, storedEntries] = await Promise.all([
        fs.readdir(materialized),
        fs.readdir(stored),
      ]);
      materializedEntries.sort();
      storedEntries.sort();
      assert.deepEqual(materializedEntries, storedEntries, relative);
      for (const entry of materializedEntries) await compare(path.join(relative, entry));
    } else if (materializedStat.isSymbolicLink()) {
      assert.equal(await fs.readlink(materialized), await fs.readlink(stored), relative);
    } else {
      assert.deepEqual(await fs.readFile(materialized), await fs.readFile(stored), relative);
    }
  };
  await compare("");
}

export async function verifyRemoteOutputs(
  command: any,
  outputs: Map<string, string>,
): Promise<void> {
  for (const name of ["remote_static", "remote_wasi_static"]) {
    const root = outputs.get(`//projects/apps/rust-wasm:${name}`)!;
    await fs.access(path.join(root, "lib/librust_wasm_fixture.a"));
    await fs.access(path.join(root, "include/rust_wasm_fixture.h"));
  }
  const browserRoot = outputs.get("//projects/apps/rust-wasm:remote_browser")!;
  const browser = path.join(browserRoot, "pkg");
  const bindings = await import(
    `${pathToFileURL(path.join(browser, "rust_wasm_fixture.js")).href}?remote=${Date.now()}`
  );
  await bindings.default(await fs.readFile(path.join(browser, "rust_wasm_fixture_bg.wasm")));
  assert.equal(bindings.answer(), 42);
  assert.equal(bindings.dependency_answer(), 42);

  for (const name of ["remote_component", "remote_wasi_component"]) {
    const root = outputs.get(`//projects/apps/rust-wasm:${name}`)!;
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, "share/viberoots-rust/wasm-manifest.json"), "utf8"),
    );
    const result =
      await command`${path.join(manifest.tools.wasmtime, "bin/wasmtime")} run --invoke ${"add(19, 23)"} ${path.join(root, "lib/rust_wasm_fixture.component.wasm")}`;
    assert.equal(String(result).trim(), "42");
  }
}
