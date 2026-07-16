import fsp from "node:fs/promises";
import path from "node:path";

export async function writeFreshCloneShims(fakeBin: string): Promise<void> {
  await Promise.all([
    fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'nix %s\n' "$*" >> "$VBR_FAKE_NIX_LOG"
if [[ "\${1:-}" == "--version" ]]; then exit 0; fi
if [[ "\${1:-}" == "run" ]]; then
  while [[ "\${1:-}" != "--" ]]; do shift; done
  shift
  cold_root="$VBR_FAKE_PREFETCH_STORE"
  [[ ! -e "$cold_root/node_modules" ]]
  VIBEROOTS_SOURCE_ROOT="$cold_root" exec "$VBR_REAL_NODE" --experimental-strip-types --import "$cold_root/build-tools/tools/dev/zx-init.mjs" "$cold_root/build-tools/tools/dev/viberoots.ts" "$@"
fi
if [[ "\${1:-}" == "flake" && "\${2:-}" == "prefetch" ]]; then
  printf '{"storePath":"%s","locked":{"narHash":"%s","path":"%s","type":"path"}}\n' "$VBR_FAKE_PREFETCH_STORE" "$VBR_FAKE_PREFETCH_NAR_HASH" "$VBR_FAKE_PREFETCH_STORE"
  exit 0
fi
if [[ "\${1:-}" == "flake" && "\${2:-}" == "metadata" ]]; then
  if [[ "\${VBR_FAIL_NETWORK_LOCK_RESOLUTION:-}" == "1" ]]; then exit 97; fi
  input_path="$PWD/.viberoots/workspace/viberoots-flake-input"
  printf '{"locks":{"nodes":{"root":{"inputs":{"viberoots":"viberoots"}},"viberoots":{"locked":{"path":"%s","type":"path"},"original":{"path":"%s","type":"path"}}},"root":"root","version":7}}\n' "$input_path" "$input_path"
  exit 0
fi
if [[ "\${1:-}" == "eval" && "$*" == *"#lib.viberootsSourcePath"* ]]; then
  printf '%s' "$VBR_FAKE_PREFETCH_STORE"
  exit 0
fi
if [[ "\${1:-}" == "flake" && ("\${2:-}" == "lock" || "\${2:-}" == "update") ]]; then
  if [[ "\${VBR_FAIL_NETWORK_LOCK_RESOLUTION:-}" == "1" ]]; then exit 97; fi
  mkdir -p .viberoots/workspace
  override=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "viberoots" ]]; then override="$arg"; break; fi
    prev="$arg"
  done
  rev="\${override##*rev=}"
  if [[ ! "$rev" =~ ^[0-9a-fA-F]{40}$ ]]; then rev="$VBR_EXPECTED_REV"; fi
  hash='sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  printf '{"nodes":{"buck2":{"locked":{"narHash":"%s","type":"github"}},"gomod2nix":{"inputs":{"nixpkgs":["nixpkgs"]},"locked":{"narHash":"%s","type":"github"}},"nixpkgs":{"locked":{"narHash":"%s","type":"github"}},"nixpkgs_23_11":{"locked":{"narHash":"%s","type":"github"}},"root":{"inputs":{"buck2":"buck2","gomod2nix":"gomod2nix","nixpkgs":"nixpkgs","nixpkgs_23_11":"nixpkgs_23_11","viberoots":"viberoots"}},"viberoots":{"inputs":{"buck2":["buck2"],"gomod2nix":["gomod2nix"],"nixpkgs":["nixpkgs"]},"locked":{"narHash":"%s","rev":"%s","type":"git","url":"https://github.com/viberoots/viberoots.git"},"original":{"rev":"%s","type":"git","url":"https://github.com/viberoots/viberoots.git"}}},"root":"root","version":7}\n' "$hash" "$hash" "$hash" "$hash" "$hash" "$rev" "$rev" > .viberoots/workspace/flake.lock
  exit 0
fi
printf 'unexpected nix invocation: %s\n' "$*" >&2
exit 92
`,
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "direnv"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then exit 0; fi
if [[ "\${1:-}" == "exec" && "\${3:-}" == "i" ]]; then
  cold_root="$PWD/.viberoots/current"
  [[ ! -e "$cold_root/node_modules" ]]
  VIBEROOTS_SOURCE_ROOT="$cold_root" exec "$VBR_REAL_NODE" --experimental-strip-types --import "$cold_root/build-tools/tools/dev/zx-init.mjs" "$cold_root/build-tools/tools/tests/viberoots/fresh-clone-post-clone-lock-check.ts" "$VBR_STALE_PNPM_LOCK"
fi
printf 'unexpected direnv invocation: %s\n' "$*" >&2
exit 93
`,
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${VBR_FAKE_GIT_FAILURE:-}" == "repo-proof" && "$*" == "rev-parse --show-toplevel" ]]; then exit 91; fi
if [[ "\${VBR_FAKE_GIT_FAILURE:-}" == "status" && "$*" == *"status --short --untracked-files=normal --ignored=no" ]]; then exit 92; fi
exec "$VBR_REAL_GIT" "$@"
`,
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "xcode-select"),
      '#!/usr/bin/env bash\nif [[ "${1:-}" == "-p" ]]; then printf "/Applications/Xcode.app/Contents/Developer\\n"; exit 0; fi\nexit 1\n',
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "xcrun"),
      '#!/usr/bin/env bash\ncase "$*" in\n  "--find clang") printf "/usr/bin/clang\\n" ;;\n  "--sdk macosx --show-sdk-path") printf "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk\\n" ;;\n  *) exit 1 ;;\nesac\n',
      { mode: 0o755 },
    ),
  ]);
}
