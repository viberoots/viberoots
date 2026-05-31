export function rootPrelude(outDir: string): string {
  return `PROFILE_ROOT="\${PROFILE_ROOT:-$(pwd)}"; if [ ! -f "$PROFILE_ROOT/commands.json" ]; then PROFILE_ROOT=${shellQuote(outDir)}; fi; if [ ! -f "$PROFILE_ROOT/commands.json" ]; then echo "commands.json not found; run from repo root or bundle directory" >&2; exit 2; fi`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
