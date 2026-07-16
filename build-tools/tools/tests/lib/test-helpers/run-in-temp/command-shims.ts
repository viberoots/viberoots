import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveToolPathSync } from "../../../../lib/tool-paths";
export async function createTempBuck2Shim(tmp: string, iso: string): Promise<string> {
  const shimDir = path.join(tmp, ".buck2_shim", "bin");
  await fsp.mkdir(shimDir, { recursive: true });
  const realBuck2 = resolveToolPathSync("buck2");
  const shimPath = path.join(shimDir, "buck2");
  await fsp.writeFile(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `real_buck2=${JSON.stringify(realBuck2)}`,
      `iso=${JSON.stringify(iso)}`,
      'for arg in "$@"; do',
      '  if [[ "$arg" == "--isolation-dir" ]]; then',
      '    exec "$real_buck2" "$@"',
      "  fi",
      "done",
      'exec "$real_buck2" --isolation-dir "$iso" "$@"',
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(shimPath, 0o755);
  return shimDir;
}

export async function createTempNixShim(shimDir: string): Promise<void> {
  const realNix = resolveToolPathSync("nix");
  const shimPath = path.join(shimDir, "nix");
  const repoRoot = process.cwd();
  const viberootsCandidates = [
    path.join(repoRoot, "viberoots"),
    path.join(repoRoot, ".viberoots", "current"),
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    repoRoot,
  ].filter(Boolean);
  let viberootsRoot = repoRoot;
  for (const candidate of viberootsCandidates) {
    const root = path.resolve(candidate);
    const consumerViberoots = path.join(root, "viberoots");
    const toolRoot = (await fsp
      .access(path.join(consumerViberoots, "build-tools", "tools", "dev", "zx-init.mjs"))
      .then(() => true)
      .catch(() => false))
      ? consumerViberoots
      : root;
    const hasTool = await fsp
      .access(path.join(toolRoot, "build-tools", "tools", "dev", "zx-init.mjs"))
      .then(() => true)
      .catch(() => false);
    if (hasTool) {
      viberootsRoot = toolRoot;
      break;
    }
  }
  await fsp.writeFile(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `real_nix=${JSON.stringify(realNix)}`,
      `viberoots_root=${JSON.stringify(viberootsRoot)}`,
      "sanitize_nix_config(){",
      '  local kept="" line key',
      '  if [[ -n "${NIX_CONFIG:-}" ]]; then',
      '    while IFS= read -r line || [[ -n "$line" ]]; do',
      '    if [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9._-]+)[[:space:]]*= ]]; then',
      '      key="${BASH_REMATCH[1]}"',
      '      if [[ "$key" == "eval-cores" || "$key" == "lazy-trees" ]]; then',
      "        continue",
      "      fi",
      "    fi",
      "    kept+=\"${line}\"$'\\n'",
      '    done <<< "$NIX_CONFIG"',
      "  fi",
      "  kept=\"${kept%$'\\n'}\"",
      '  if ! grep -Eq "^[[:space:]]*warn-dirty[[:space:]]*=" <<< "$kept"; then',
      "    kept+=\"${kept:+$'\\n'}warn-dirty = false\"",
      "  fi",
      '  if [[ -n "$kept" ]]; then export NIX_CONFIG="$kept"; else unset NIX_CONFIG; fi',
      "}",
      "sanitize_nix_config",
      'if [[ "${1:-}" == "store" && "${2:-}" == "gc" ]]; then',
      '  exec "$real_nix" "$@"',
      "fi",
      "wait_for_gc(){",
      '  node --experimental-strip-types --import "$viberoots_root/build-tools/tools/dev/zx-init.mjs" "$viberoots_root/build-tools/tools/lib/nix-gc-lock.ts" wait-for-no-active-gc',
      "}",
      'transient_store_error(){ grep -Eq "path .*/nix/store/.*\\.drv. is not valid|database is locked" "$1" "$2"; }',
      "attempt=0",
      'max_attempts="${NIX_TRANSIENT_RETRY_ATTEMPTS:-5}"',
      "while true; do",
      "  wait_for_gc || true",
      '  out="$(mktemp "${TMPDIR:-/tmp}/vbr-nix-shim-out.XXXXXX")"',
      '  err="$(mktemp "${TMPDIR:-/tmp}/vbr-nix-shim-err.XXXXXX")"',
      "  set +e",
      '  "$real_nix" "$@" >"$out" 2>"$err"',
      "  code=$?",
      "  set -e",
      '  cat "$out"',
      '  cat "$err" >&2',
      '  if [[ "$code" == "0" ]]; then rm -f "$out" "$err"; exit 0; fi',
      '  if (( attempt >= max_attempts )) || ! transient_store_error "$out" "$err"; then rm -f "$out" "$err"; exit "$code"; fi',
      "  attempt=$((attempt + 1))",
      '  echo "[nix-shim] transient nix store error; retrying ${attempt}/${max_attempts}" >&2',
      '  rm -f "$out" "$err"',
      "  sleep 1",
      "done",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(shimPath, 0o755);
}

export async function createTempZxWrapperShim(shimDir: string): Promise<void> {
  const realZxWrapper = resolveToolPathSync("zx-wrapper");
  const shimPath = path.join(shimDir, "zx-wrapper");
  await fsp.writeFile(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `real_zx_wrapper=${JSON.stringify(realZxWrapper)}`,
      'if [[ "${1:-}" == build-tools/* && ! -e "${1:-}" && -n "${VIBEROOTS_ROOT:-}" && -e "$VIBEROOTS_ROOT/${1:-}" ]]; then',
      '  set -- "$VIBEROOTS_ROOT/$1" "${@:2}"',
      "fi",
      'exec "$real_zx_wrapper" "$@"',
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(shimPath, 0o755);
}

export function prependPath(env: Record<string, string>, dir: string): void {
  env.PATH = [dir, env.PATH || process.env.PATH || ""].filter(Boolean).join(path.delimiter);
}

export function applyTempNodePath(
  env: Record<string, string>,
  paths: Array<string | undefined>,
): void {
  env.NODE_PATH = [
    env.VIBEROOTS_NODE_PATH,
    process.env.VIBEROOTS_NODE_PATH,
    ...paths,
    env.NODE_PATH || "",
  ]
    .filter(Boolean)
    .join(path.delimiter);
}

export async function prependTempRepoBin(env: Record<string, string>, tmp: string): Promise<void> {
  const candidates = [
    path.join(tmp, "viberoots", "build-tools", "tools", "bin"),
    env.VIBEROOTS_ROOT ? path.join(env.VIBEROOTS_ROOT, "build-tools", "tools", "bin") : "",
  ].filter(Boolean);
  for (const binDir of candidates.reverse()) {
    const st = await fsp.stat(binDir).catch(() => null);
    if (st?.isDirectory()) prependPath(env, binDir);
  }
}
