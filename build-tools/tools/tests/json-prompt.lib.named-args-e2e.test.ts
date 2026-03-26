#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("json-prompt-lib: named-args output expands into another command as named arguments", async () => {
  const script = `
set -euo pipefail
args=("\${(@f)$(cat <<'EOF' | build-tools/tools/bin/json-prompt --output=named-args
{"name":"Jane Doe","count":2,"enabled":true}
EOF
)}")
[ "\${#args[@]}" -eq 6 ]
printf '%s\n' "\${args[@]}"
`;
  const { stdout } = await execFile("zsh", ["-lc", script], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.deepEqual(String(stdout).trim().split("\n"), [
    "--name",
    "Jane Doe",
    "--count",
    "2",
    "--enabled",
    "true",
  ]);
});

test("json-prompt-lib: named-args output can control another command via parsed flags", async () => {
  const script = `
set -euo pipefail
args=("\${(@f)$(cat <<'EOF' | build-tools/tools/bin/json-prompt --output=named-args
{"name":"Jane Doe","count":2,"enabled":true}
EOF
)}")
[ "\${#args[@]}" -eq 6 ]
zsh -lc '
  set -euo pipefail
  typeset name=""
  typeset count=""
  typeset enabled=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --name)
        name="$2"
        shift 2
        ;;
      --count)
        count="$2"
        shift 2
        ;;
      --enabled)
        enabled="$2"
        shift 2
        ;;
      *)
        exit 64
        ;;
    esac
  done
  [ "$name" = "Jane Doe" ]
  [ "$count" = "2" ]
  [ "$enabled" = "true" ]
  if [ "$enabled" = "true" ] && [ "$count" = "2" ]; then
    print -r -- "configured:$name:$count"
  else
    exit 65
  fi
' -- "\${args[@]}"
`;
  const { stdout } = await execFile("zsh", ["-lc", script], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.equal(String(stdout).trim(), "configured:Jane Doe:2");
});

test("json-prompt-lib: named-args output can emit bare flags for boolean true values", async () => {
  const script = `
set -euo pipefail
args=("\${(@f)$(cat <<'EOF' | build-tools/tools/bin/json-prompt --output=named-args --rules '{"fieldTypes":{"json":"boolean"},"namedArgModes":{"json":"flag"}}'
{"json":true,"name":"demo"}
EOF
)}")
[ "\${#args[@]}" -eq 3 ]
zsh -lc '
  set -euo pipefail
  typeset json_seen="false"
  typeset name=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --json)
        json_seen="true"
        shift
        ;;
      --name)
        name="$2"
        shift 2
        ;;
      *)
        exit 64
        ;;
    esac
  done
  [ "$json_seen" = "true" ]
  [ "$name" = "demo" ]
  print -r -- "flagged:$name"
' -- "\${args[@]}"
`;
  const { stdout } = await execFile("zsh", ["-lc", script], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.equal(String(stdout).trim(), "flagged:demo");
});
