export function requirePositional(
  args: string[],
  index: number,
  opts: { name: string; example: string },
): string {
  const val = (args[index] || "").trim();
  if (!val) {
    // Preserve existing wording style exactly: "missing <...>, e.g. ..."
    throw new Error(`missing ${opts.name}, e.g. ${opts.example}`);
  }
  return val;
}
