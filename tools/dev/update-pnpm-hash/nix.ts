export function extractHash(text: string): string | null {
  const all = Array.from(text.matchAll(/sha256-[A-Za-z0-9+/=\-_]{43,}/g)).map((m) => m[0]);
  if (all.length) return all[all.length - 1];
  return null;
}

export async function buildStore(attrPath: string): Promise<{ ok: boolean; output: string }> {
  try {
    const maxJobs = String(process.env.NIX_MAX_JOBS || "").trim();
    const cores = String(process.env.NIX_CORES || "").trim();
    const timeoutSec = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim();
    const cmd = [
      "set -euo pipefail;",
      'MJ="${NIX_MAX_JOBS:-' + (maxJobs || "0") + '}";',
      'CR="${NIX_CORES:-' + (cores || "0") + '}";',
      'TS="' + timeoutSec + '";',
      'TO=""; if command -v timeout >/dev/null 2>&1; then TO="timeout -k 10s ${TS}s "; elif command -v gtimeout >/dev/null 2>&1; then TO="gtimeout -k 10s ${TS}s "; fi;',
      'JOBS_FLAG=""; if [ -n "$MJ" ] && [ "$MJ" != "0" ]; then JOBS_FLAG="--max-jobs $MJ"; fi;',
      'CORES_FLAG=""; if [ -n "$CR" ] && [ "$CR" != "0" ]; then CORES_FLAG="--option cores $CR"; fi;',
      `$TO nix build .#${attrPath} --impure --no-link --accept-flake-config --builders "" $JOBS_FLAG $CORES_FLAG`,
    ].join(" ");
    const res = await $({ stdio: "pipe" })`bash --noprofile --norc -c ${cmd}`;
    return { ok: true, output: String(res.stdout || "") + String(res.stderr || "") };
  } catch (e: any) {
    const out = String((e && e.stdout) || "") + String((e && e.stderr) || "");
    return { ok: false, output: out };
  }
}

export async function buildUnfixedAndHash(
  attrPath: string,
): Promise<{ ok: boolean; sri?: string; output?: string }> {
  try {
    const maxJobs = String(process.env.NIX_MAX_JOBS || "").trim();
    const cores = String(process.env.NIX_CORES || "").trim();
    const timeoutSec = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim();
    const cmd = [
      "set -euo pipefail;",
      'MJ="${NIX_MAX_JOBS:-' + (maxJobs || "0") + '}";',
      'CR="${NIX_CORES:-' + (cores || "0") + '}";',
      'TS="' + timeoutSec + '";',
      'TO=""; if command -v timeout >/dev/null 2>&1; then TO="timeout -k 10s ${TS}s "; elif command -v gtimeout >/dev/null 2>&1; then TO="gtimeout -k 10s ${TS}s "; fi;',
      'JOBS_FLAG=""; if [ -n "$MJ" ] && [ "$MJ" != "0" ]; then JOBS_FLAG="--max-jobs $MJ"; fi;',
      'CORES_FLAG=""; if [ -n "$CR" ] && [ "$CR" != "0" ]; then CORES_FLAG="--option cores $CR"; fi;',
      `$TO nix build .#${attrPath} --impure --no-link --accept-flake-config --builders "" --print-out-paths $JOBS_FLAG $CORES_FLAG`,
    ].join(" ");
    const built = await $({ stdio: "pipe" })`bash --noprofile --norc -c ${cmd}`;
    const outPath =
      String(built.stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop() || "";
    if (!outPath) {
      return { ok: false, output: "nix build returned no out path for " + attrPath };
    }
    // Hash the entire unfixed output path to match the fixed-output derivation's outputHash.
    // The output includes both 'store' and 'lockfile' directories; hashing only 'store'
    // would drift from the fixed-output derivation hash.
    const hashed = await $({
      stdio: "pipe",
    })`nix hash path --sri ${outPath}`;
    const sri = String(hashed.stdout || "").trim();
    if (!/^sha256-[A-Za-z0-9+/=_-]+$/.test(sri)) {
      return { ok: false, output: "unexpected hash-path output: " + sri };
    }
    return { ok: true, sri };
  } catch (e: any) {
    const out = String((e && e.stdout) || "") + String((e && e.stderr) || "");
    return { ok: false, output: out };
  }
}

async function currentSystem(): Promise<string> {
  try {
    const res = await $({ stdio: "pipe" })`nix eval --impure --expr builtins.currentSystem`;
    return String(res.stdout || "")
      .trim()
      .replace(/^"|"$/g, "");
  } catch {
    return "";
  }
}

export async function flakeAttrExists(attrset: string, key: string): Promise<boolean> {
  try {
    const sys = await currentSystem();
    if (!sys) return false;
    const out = await $({
      stdio: "pipe",
    })`bash --noprofile --norc -c ${`nix eval .#packages.${sys}.${attrset} --apply 'builtins.hasAttr "${key}"' --accept-flake-config`}`;
    const val = String(out.stdout || "").trim();
    return val === "true";
  } catch {
    return false;
  }
}
