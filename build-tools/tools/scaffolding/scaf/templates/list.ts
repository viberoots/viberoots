import type { TemplateMetaRow } from "./meta";

function terminalWidth(): number {
  const raw = Number.parseInt(String(process.env.COLUMNS || ""), 10);
  return Number.isFinite(raw) && raw >= 60 ? raw : 100;
}

export function wrapText(text: string, width: number): string[] {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line += ` ${word}`;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapCsv(values: string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const value of values) {
    const next = line ? `${line}, ${value}` : value;
    if (line && next.length > width) {
      lines.push(line);
      line = value;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

export function formatTemplateListLines(
  metas: TemplateMetaRow[],
  opts: { details?: boolean; grouped?: boolean } = {},
): string[] {
  const width = terminalWidth();
  const showDetails = opts.details === true;
  const grouped = opts.grouped !== false;
  const idFor = (m: TemplateMetaRow) => (grouped ? m.template : `${m.language} ${m.template}`);
  const idWidth = Math.min(30, Math.max(14, ...metas.map((m) => idFor(m).length)));
  const descWidth = Math.max(28, width - idWidth - 4);
  const lines: string[] = [];
  let currentLanguage = "";
  for (const m of metas) {
    if (grouped && m.language !== currentLanguage) {
      if (lines.length) lines.push("");
      lines.push(`${m.language}:`);
      currentLanguage = m.language;
    }
    const rowPrefix = grouped ? "  " : "";
    const id = idFor(m);
    const descLines = wrapText(m.description || "", descWidth);
    lines.push(`${rowPrefix}${id.padEnd(idWidth)}  ${descLines[0] || ""}`.trimEnd());
    for (const continuation of descLines.slice(1)) {
      lines.push(`${rowPrefix}${"".padEnd(idWidth)}  ${continuation}`.trimEnd());
    }
    if (showDetails && Array.isArray(m.variables) && m.variables.length > 0) {
      const prefix = `${rowPrefix}  vars: `;
      const varWidth = Math.max(24, width - prefix.length);
      const varLines = wrapCsv(m.variables, varWidth);
      lines.push(`${prefix}${varLines[0]}`);
      for (const continuation of varLines.slice(1)) {
        lines.push(`${"".padEnd(prefix.length)}${continuation}`);
      }
    }
  }
  return lines;
}

export function formatHangingLines(
  text: string,
  opts: { firstPrefix?: string; nextPrefix?: string; width?: number } = {},
): string[] {
  const firstPrefix = opts.firstPrefix || "";
  const nextPrefix = opts.nextPrefix ?? firstPrefix;
  const width = opts.width || terminalWidth();
  const bodyWidth = Math.max(20, width - Math.max(firstPrefix.length, nextPrefix.length));
  const wrapped = wrapText(text, bodyWidth);
  return wrapped.map((line, index) => `${index === 0 ? firstPrefix : nextPrefix}${line}`);
}

export function printTemplateList(
  metas: TemplateMetaRow[],
  opts: { json?: boolean; details?: boolean } = {},
) {
  if (opts.json) {
    console.log(JSON.stringify(metas, null, 2));
    return;
  }
  console.log(formatTemplateListLines(metas, { details: opts.details }).join("\n"));
}
