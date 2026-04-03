#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

const FAKE_SSH = `#!/usr/bin/env bash
set -euo pipefail
destination="\${1:-}"
shift || true
if [[ "\${FAKE_SSH_FAIL:-0}" == "1" ]]; then
  echo "fake ssh transport failure for \${destination}" >&2
  exit 97
fi
if [[ "\${1:-}" != "bash" || "\${2:-}" != "-lc" ]]; then
  echo "fake ssh only supports: ssh <destination> bash -lc <script>" >&2
  exit 98
fi
script="\${3:-}"
path_q="$(printf '%q' "\${PATH}")"
exec bash -lc "export PATH=\${path_q}; \${script}"
`;

const FAKE_DIRENV = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" != "exec" ]]; then
  echo "fake direnv only supports: direnv exec <dir> <command...>" >&2
  exit 101
fi
shift
workdir="\${1:-}"
shift || true
if [[ -z "\${workdir}" || "$#" -eq 0 ]]; then
  echo "fake direnv expects a workdir and command" >&2
  exit 102
fi
cd -- "\${workdir}"
exec "$@"
`;

const FAKE_SUDO = `#!/usr/bin/env bash
set -euo pipefail
exec "$@"
`;

const FAKE_NIXOS_REBUILD = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${FAKE_NIXOS_REBUILD_FAIL:-0}" == "1" ]]; then
  echo "fake nixos-rebuild failure" >&2
  exit 103
fi
if [[ -n "\${FAKE_NIXOS_REBUILD_LOG:-}" ]]; then
  printf '%s\\n' "$*" >> "\${FAKE_NIXOS_REBUILD_LOG}"
fi
`;

const FAKE_RSYNC = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${FAKE_RSYNC_FAIL:-0}" == "1" ]]; then
  echo "fake rsync staging failure" >&2
  exit 99
fi
src=""
dest=""
for arg in "$@"; do
  if [[ "$arg" == -* ]]; then
    continue
  fi
  if [[ -z "$src" ]]; then
    src="$arg"
  elif [[ -z "$dest" ]]; then
    dest="$arg"
  fi
done
if [[ -z "$src" || -z "$dest" || "$dest" != *:* ]]; then
  echo "fake rsync expects <src> <host:path>" >&2
  exit 100
fi
remote_path="\${dest#*:}"
rm -rf -- "\${remote_path}"
mkdir -p -- "\${remote_path}"
cp -R "\${src%/}"/. "\${remote_path}"/
`;

export async function installFakeRemoteTransport(
  tmp: string,
): Promise<{ env: Record<string, string> }> {
  const binDir = path.join(tmp, "fake-remote-bin");
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(path.join(binDir, "ssh"), FAKE_SSH, "utf8");
  await fsp.writeFile(path.join(binDir, "direnv"), FAKE_DIRENV, "utf8");
  await fsp.writeFile(path.join(binDir, "rsync"), FAKE_RSYNC, "utf8");
  await fsp.writeFile(path.join(binDir, "sudo"), FAKE_SUDO, "utf8");
  await fsp.writeFile(path.join(binDir, "nixos-rebuild"), FAKE_NIXOS_REBUILD, "utf8");
  await Promise.all([
    fsp.chmod(path.join(binDir, "ssh"), 0o755),
    fsp.chmod(path.join(binDir, "direnv"), 0o755),
    fsp.chmod(path.join(binDir, "rsync"), 0o755),
    fsp.chmod(path.join(binDir, "sudo"), 0o755),
    fsp.chmod(path.join(binDir, "nixos-rebuild"), 0o755),
  ]);
  return {
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      PATH: `${binDir}:${process.env.PATH || ""}`,
    },
  };
}
