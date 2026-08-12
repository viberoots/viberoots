import fs from "node:fs/promises";
import path from "node:path";
import type { ProtectedRustPatchCaseDefinition } from "./protected-rust-patch-case-definitions";

export async function installProtectedConsumerSources(
  workspaceRoot: string,
  definition: ProtectedRustPatchCaseDefinition,
  protectedCrate: string,
): Promise<void> {
  const owner = path.join(workspaceRoot, definition.cargoRoot);
  const library = path.join(owner, "src/lib.rs");
  let source = await fs.readFile(library, "utf8");
  if (definition.matrixCase.scaffoldRecipe.template === "proc-macro") {
    source += [
      "",
      "#[proc_macro]",
      "pub fn viberoots_observed_behavior(_: TokenStream) -> TokenStream {",
      `    ${protectedCrate}::observed().to_string().parse().unwrap()`,
      "}",
      "",
    ].join("\n");
  } else if (definition.matrixCase.graphSelection.outputRole === "browser-package") {
    source += [
      "",
      "#[wasm_bindgen]",
      "pub fn viberoots_observed_behavior() -> i32 {",
      `    ${protectedCrate}::observed()`,
      "}",
      "",
    ].join("\n");
  } else {
    source += [
      "",
      "#[no_mangle]",
      'pub extern "C" fn viberoots_observed_behavior() -> i32 {',
      `    ${protectedCrate}::observed()`,
      "}",
      "",
    ].join("\n");
    if (definition.matrixCase.graphSelection.outputRole === "component-module") {
      source += [
        '#[export_name = "viberoots-observed-behavior"]',
        'pub extern "C" fn viberoots_component_observed_behavior() -> i32 {',
        `    ${protectedCrate}::observed()`,
        "}",
        "",
      ].join("\n");
      const wit = path.join(owner, "wit/answer.wit");
      const witSource = await fs.readFile(wit, "utf8");
      const worldClose = witSource.lastIndexOf("}");
      if (worldClose < 0) throw new Error(`protected Rust component WIT is malformed: ${wit}`);
      await fs.writeFile(
        wit,
        `${witSource.slice(0, worldClose)}  export viberoots-observed-behavior: func() -> s32;\n${witSource.slice(worldClose)}`,
      );
    }
  }
  await fs.writeFile(library, source);
  const main = path.join(owner, "src/main.rs");
  const mainText = await fs.readFile(main, "utf8").catch(() => "");
  if (mainText && definition.id !== "rust-tauri-darwin-pr12") {
    const observed = [
      "fn main() {",
      "    println!(",
      '        "VIBEROOTS_OBSERVED_BEHAVIOR={}",',
      `        ${protectedCrate}::observed()`,
      "    );",
      "}",
      ...(definition.matrixCase.graphSelection.outputRole === "wasi"
        ? [
            "",
            "#[no_mangle]",
            'pub extern "C" fn viberoots_observed_behavior() -> i32 {',
            `    ${protectedCrate}::observed()`,
            "}",
          ]
        : []),
    ].join("\n");
    await fs.writeFile(main, mainText.replace(/fn main\(\) \{[\s\S]*?\n\}/u, observed));
  }
  if (definition.matrixCase.graphSelection.outputRole === "test") {
    await fs.appendFile(
      library,
      [
        "",
        "#[cfg(test)]",
        "mod viberoots_behavior_probe {",
        "    #[test]",
        "    fn observes_protected_dependency() {",
        "        println!(",
        '            "VIBEROOTS_OBSERVED_BEHAVIOR={}",',
        `            ${protectedCrate}::observed()`,
        "        );",
        "    }",
        "}",
        "",
      ].join("\n"),
    );
  }
  if (definition.id === "rust-cross-root-pr12") {
    const app = path.join(
      workspaceRoot,
      "projects/libs",
      `${definition.matrixCase.scaffoldRecipe.name}-app/src/lib.rs`,
    );
    await fs.appendFile(
      app,
      `\n#[no_mangle]\npub extern "C" fn viberoots_observed_behavior() -> i32 {\n    ${protectedCrate}::observed()\n}\n`,
    );
  }
}

export function injectProtectedTargetArgs(
  text: string,
  targetName: string,
  args: string[],
): string {
  const { open, close } = targetCallBounds(text, targetName);
  const existing = text.slice(open + 1, close).trimEnd();
  const separator = existing && !existing.endsWith(",") ? "," : "";
  const insertion = `${separator}\n    ${args.join("\n    ")}\n`;
  return `${text.slice(0, close)}${insertion}${text.slice(close)}`;
}

export function injectProtectedTargetSources(
  text: string,
  targetName: string,
  srcs: string[],
): string {
  const { open, close } = targetCallBounds(text, targetName);
  const call = text.slice(open, close);
  const match = /srcs\s*=\s*\[([^\]]*)\]/u.exec(call);
  if (!match) throw new Error(`protected Rust target has no srcs: ${targetName}`);
  const replacement = `srcs = [${match[1]}${srcs.map((src) => `, ${JSON.stringify(src)}`).join("")}]`;
  return `${text.slice(0, open + match.index)}${replacement}${text.slice(open + match.index + match[0].length)}`;
}

function targetCallBounds(text: string, targetName: string): { open: number; close: number } {
  const marker = new RegExp(`name\\s*=\\s*${JSON.stringify(targetName)}`, "u").exec(text);
  if (!marker) throw new Error(`protected Rust target is absent: ${targetName}`);
  const open = text.lastIndexOf("(", marker.index);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] !== ")") continue;
    depth -= 1;
    if (depth === 0) return { open, close: index };
  }
  throw new Error(`protected Rust target is malformed: ${targetName}`);
}
