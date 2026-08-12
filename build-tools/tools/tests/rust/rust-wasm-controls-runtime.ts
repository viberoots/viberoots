import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";

async function selected(
  tmp: string,
  current: string,
  tools: string,
  target: string,
  derivationOutput: "out" | "provenance" = "out",
): Promise<string> {
  return (
    await buildCanonicalBundle(
      tmp,
      "graph-generator-selected",
      current,
      process.env,
      target,
      tools,
      true,
      derivationOutput,
    )
  ).outPath;
}

export async function verifyWasmControls(
  tmp: string,
  command: any,
  current: string,
  tools: string,
): Promise<void> {
  const [raw, staticDefault, staticDebug, staticSize, componentDebug, componentInterface] =
    await Promise.all([
      selected(tmp, current, tools, "//projects/apps/rust-wasm:raw_allowlist"),
      selected(tmp, current, tools, "//projects/apps/rust-wasm-static-profile:none"),
      selected(tmp, current, tools, "//projects/apps/rust-wasm-static-profile:speed_debug"),
      selected(tmp, current, tools, "//projects/apps/rust-wasm-static-profile:size"),
      selected(tmp, current, tools, "//projects/apps/rust-wasm:component_debug"),
      selected(tmp, current, tools, "//projects/apps/rust-wasm:component_interface"),
    ]);
  const [
    staticDefaultEvidence,
    staticDebugEvidence,
    staticSizeEvidence,
    componentDebugEvidence,
    componentInterfaceEvidence,
  ] = await Promise.all([
    selected(tmp, current, tools, "//projects/apps/rust-wasm-static-profile:none", "provenance"),
    selected(
      tmp,
      current,
      tools,
      "//projects/apps/rust-wasm-static-profile:speed_debug",
      "provenance",
    ),
    selected(tmp, current, tools, "//projects/apps/rust-wasm-static-profile:size", "provenance"),
    selected(tmp, current, tools, "//projects/apps/rust-wasm:component_debug", "provenance"),
    selected(tmp, current, tools, "//projects/apps/rust-wasm:component_interface", "provenance"),
  ]);
  const rawBytes = await fs.readFile(path.join(raw, "lib/rust_wasm_fixture.wasm"));
  const exports = WebAssembly.Module.exports(await WebAssembly.compile(rawBytes)).map(
    (entry) => entry.name,
  );
  assert.deepEqual(exports, ["answer"]);
  const staticManifest = JSON.parse(
    await fs.readFile(
      path.join(staticDebugEvidence, "share/viberoots-rust/wasm-manifest.json"),
      "utf8",
    ),
  );
  assert.deepEqual([staticManifest.optimize, staticManifest.debug], ["speed", true]);
  assert.deepEqual(staticManifest.compilePolicy, { debuginfo: "2", optLevel: "2" });
  await fs.access(path.join(staticDebug, "include/rust_wasm_fixture.h"));
  const defaultManifest = JSON.parse(
    await fs.readFile(
      path.join(staticDefaultEvidence, "share/viberoots-rust/wasm-manifest.json"),
      "utf8",
    ),
  );
  assert.deepEqual(defaultManifest.compilePolicy, { debuginfo: "0", optLevel: "0" });
  const defaultPrimary = await verifyArchiveMembers(
    tmp,
    command,
    staticDefault,
    defaultManifest,
    false,
  );
  const debugPrimary = await verifyArchiveMembers(tmp, command, staticDebug, staticManifest, true);
  const sizeManifest = JSON.parse(
    await fs.readFile(
      path.join(staticSizeEvidence, "share/viberoots-rust/wasm-manifest.json"),
      "utf8",
    ),
  );
  assert.deepEqual(sizeManifest.compilePolicy, { debuginfo: "0", optLevel: "z" });
  const sizePrimary = await verifyArchiveMembers(tmp, command, staticSize, sizeManifest, false);
  assert.ok(
    sizePrimary.codeBytes <= defaultPrimary.codeBytes,
    `size optimization grew the primary answer member code: ${sizePrimary.codeBytes} > ${defaultPrimary.codeBytes}`,
  );
  assert.ok(
    debugPrimary.fileBytes > defaultPrimary.fileBytes,
    `debug policy did not increase the primary answer member: ${debugPrimary.fileBytes} <= ${defaultPrimary.fileBytes}`,
  );
  const componentManifest = JSON.parse(
    await fs.readFile(
      path.join(componentDebugEvidence, "share/viberoots-rust/wasm-manifest.json"),
      "utf8",
    ),
  );
  assert.deepEqual([componentManifest.optimize, componentManifest.debug], ["speed", true]);
  const component = path.join(componentDebug, "lib/rust_wasm_fixture.component.wasm");
  assert.equal(
    String(
      await command`${path.join(componentManifest.tools.wasmtime, "bin/wasmtime")} run --invoke ${"add(19, 23)"} ${component}`,
    ).trim(),
    "42",
  );
  const interfaceManifest = JSON.parse(
    await fs.readFile(
      path.join(componentInterfaceEvidence, "share/viberoots-rust/wasm-manifest.json"),
      "utf8",
    ),
  );
  assert.match(
    await fs.readFile(path.join(componentInterface, "lib/rust_wasm_fixture.component.wit"), "utf8"),
    /interface api[\s\S]*ping: func/,
  );
  assert.equal(interfaceManifest.world, "calculator-with-api");
  for (const [name, companions] of [
    ["static", ["lib/librust_wasm_fixture.a", "include/rust_wasm_fixture.h"]],
    ["component", ["lib/rust_wasm_fixture.component.wasm", "lib/rust_wasm_fixture.component.wit"]],
  ] as const) {
    const built =
      await command`buck2 build --target-platforms prelude//platforms:default --show-output ${`//projects/apps/rust-wasm:${name}`}`;
    const output = String(built.stdout || built.stderr)
      .trim()
      .split(/\n+/)
      .at(-1)!
      .split(/\s+/)
      .at(-1)!;
    const root = path.isAbsolute(output) ? output : path.join(tmp, output);
    const provenanceBuilt =
      await command`buck2 build --target-platforms prelude//platforms:default --show-output ${`//projects/apps/rust-wasm:${name}[provenance]`}`;
    const provenanceOutput = String(provenanceBuilt.stdout || provenanceBuilt.stderr)
      .trim()
      .split(/\n+/)
      .at(-1)!
      .split(/\s+/)
      .at(-1)!;
    const provenanceRoot = path.isAbsolute(provenanceOutput)
      ? provenanceOutput
      : path.join(tmp, provenanceOutput);
    for (const companion of companions) await fs.access(path.join(root, companion));
    await fs.access(
      path.join(provenanceRoot, "share/viberoots-rust/materialization-manifest.json"),
    );
    await fs.access(path.join(provenanceRoot, "share/viberoots-rust/wasm-manifest.json"));
  }
}

async function verifyArchiveMembers(
  tmp: string,
  command: any,
  output: string,
  manifest: any,
  expectDebug: boolean,
): Promise<{ fileBytes: number; codeBytes: number; hasDebug: boolean }> {
  const archive = path.join(output, "lib/librust_wasm_fixture.a");
  const extract = await fs.mkdtemp(path.join(tmp, "rust-wasm-members-"));
  const llvmAr = path.join(manifest.tools.llvm, "bin/llvm-ar");
  await command({ cwd: extract })`${llvmAr} x ${archive}`;
  const members = (await fs.readdir(extract)).filter((name) => name.endsWith(".o")).sort();
  assert.ok(members.length > 0);
  const primary: Array<{ fileBytes: number; codeBytes: number; hasDebug: boolean }> = [];
  for (const member of members) {
    const memberPath = path.join(extract, member);
    const symbols = String(
      await command`${path.join(manifest.tools.llvm, "bin/llvm-nm")} --defined-only ${memberPath}`,
    );
    const dump = String(
      await command`${path.join(manifest.tools.wasmTools, "bin/wasm-tools")} objdump ${memberPath}`,
    );
    assert.match(dump, /custom "linking"/);
    assert.match(dump, /custom "target_features"/);
    if (/(?:^|\s)answer$/m.test(symbols)) {
      const code = dump.match(/^\s*code\s+\|[^|]+\|\s+(\d+) bytes/m);
      assert.ok(code, "wasm-tools objdump must report the primary object code-section size");
      primary.push({
        fileBytes: (await fs.stat(memberPath)).size,
        codeBytes: Number.parseInt(code[1], 10),
        hasDebug: /custom "\.debug_/.test(dump),
      });
    }
  }
  assert.equal(primary.length, 1, "llvm-nm must identify exactly one object defining answer");
  assert.equal(primary[0].hasDebug, expectDebug);
  return primary[0];
}
