export function shSingleQuote(s: string): string {
  return `'${String(s || "").replaceAll("'", `'\"'\"'`)}'`;
}
