const FS_MODULE = String.raw`node:fs(?:/promises)?`;
const READ_NAMES = new Set([
  "access",
  "createReadStream",
  "exists",
  "lstat",
  "opendir",
  "read",
  "readFile",
  "readdir",
  "readlink",
  "realpath",
  "stat",
  "statfs",
]);

function normalizedName(value: string): string {
  return value
    .trim()
    .replace(/^type\s+/, "")
    .replace(/Sync$/, "");
}

function maskNonCode(source: string): string {
  const chars = source.split("");
  let mode: "code" | "line" | "block" | "quote" | "template" = "code";
  let quote = "";
  let templateExpressionDepth = 0;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const next = chars[i + 1] || "";
    if (mode === "line") {
      if (char === "\n") mode = "code";
      else chars[i] = " ";
      continue;
    }
    if (mode === "block") {
      chars[i] = " ";
      if (char === "*" && next === "/") {
        chars[++i] = " ";
        mode = "code";
      }
      continue;
    }
    if (mode === "quote") {
      chars[i] = " ";
      if (char === "\\") chars[++i] = " ";
      else if (char === quote) mode = "code";
      continue;
    }
    if (mode === "template") {
      chars[i] = " ";
      if (char === "\\") chars[++i] = " ";
      else if (char === "`" && templateExpressionDepth === 0) mode = "code";
      else if (char === "$" && next === "{") {
        chars[i] = "$";
        chars[++i] = "{";
        templateExpressionDepth = 1;
        mode = "code";
      }
      continue;
    }
    if (templateExpressionDepth > 0) {
      if (char === "{") templateExpressionDepth++;
      if (char === "}" && --templateExpressionDepth === 0) {
        mode = "template";
        continue;
      }
    }
    if (char === "/" && next === "/") {
      chars[i] = chars[++i] = " ";
      mode = "line";
    } else if (char === "/" && next === "*") {
      chars[i] = chars[++i] = " ";
      mode = "block";
    } else if (char === '"' || char === "'") {
      chars[i] = " ";
      quote = char;
      mode = "quote";
    } else if (char === "`") {
      chars[i] = " ";
      mode = "template";
    }
  }
  return chars.join("");
}

function importedBindings(source: string): {
  bindings: Set<string>;
  declarationRanges: Array<[number, number]>;
  unsafe: boolean;
} {
  const bindings = new Set<string>();
  const declarationRanges: Array<[number, number]> = [];
  let unsafe = false;
  const imports = new RegExp(
    String.raw`(?:^|\n)\s*import\s+([^;]+?)\s+from\s+["']${FS_MODULE}["']\s*;?`,
    "g",
  );
  for (const match of source.matchAll(imports)) {
    declarationRanges.push([match.index!, match.index! + match[0].length]);
    const clause = match[1]!.trim();
    const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (namespace) bindings.add(namespace[1]!);
    const defaultBinding = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (defaultBinding && defaultBinding[1] !== "type") bindings.add(defaultBinding[1]!);
    const named = clause.match(/\{([\s\S]*)\}/)?.[1] || "";
    for (const entry of named
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      const [importedRaw, localRaw] = entry.split(/\s+as\s+/);
      const imported = normalizedName(importedRaw || "");
      const local = String(localRaw || importedRaw || "").trim();
      if (imported === "promises") bindings.add(local);
      else if (!READ_NAMES.has(imported)) unsafe = true;
    }
  }
  return { bindings, declarationRanges, unsafe };
}

function unsafeReexport(source: string): boolean {
  if (new RegExp(String.raw`\bexport\s*\*[^;\n]*from\s*["']${FS_MODULE}["']`).test(source)) {
    return true;
  }
  const exports = new RegExp(
    String.raw`\bexport\s*\{([\s\S]*?)\}\s*from\s*["']${FS_MODULE}["']`,
    "g",
  );
  for (const match of source.matchAll(exports)) {
    for (const entry of match[1]!.split(",")) {
      const exported = normalizedName(entry.split(/\s+as\s+/)[0] || "");
      if (exported === "promises" || !READ_NAMES.has(exported)) return true;
    }
  }
  return false;
}

function readOnlyReference(source: string, mask: string, start: number, end: number): boolean {
  const rest = mask.slice(end);
  const direct = rest.match(/^\s*(?:\?\s*)?\.\s*(?:promises\s*\.\s*)?([A-Za-z_$][\w$]*)/);
  if (direct) return READ_NAMES.has(normalizedName(direct[1]!));
  const computed = rest.match(/^\s*(?:\?\s*\.\s*)?\[([^\]]*)\]/);
  if (!computed) return false;
  const expressionStart = end + computed.index! + computed[0].indexOf("[") + 1;
  const original = source.slice(expressionStart, expressionStart + computed[1]!.length).trim();
  const literal = original.match(/^(?:["'])([^"']+)(?:["'])$/)?.[1] || "";
  return READ_NAMES.has(normalizedName(literal));
}

export function hasUnsafeFilesystemCapability(source: string): boolean {
  if (unsafeReexport(source)) return true;
  const { bindings, declarationRanges, unsafe } = importedBindings(source);
  if (unsafe) return true;
  let mask = maskNonCode(source);
  const chars = mask.split("");
  for (const [start, end] of declarationRanges) for (let i = start; i < end; i++) chars[i] = " ";
  mask = chars.join("");
  for (const binding of bindings) {
    const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of mask.matchAll(new RegExp(`\\b${escaped}\\b`, "g"))) {
      const start = match.index!;
      const previous =
        mask
          .slice(0, start)
          .match(/\S\s*$/)?.[0]
          .trim() || "";
      if (previous === ".") continue;
      if (!readOnlyReference(source, mask, start, start + binding.length)) return true;
    }
  }
  return false;
}
