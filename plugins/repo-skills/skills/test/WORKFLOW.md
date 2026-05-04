---
name: test
description: Run this repository's validation flow in a delegated tester subagent, optionally with a verify test selector, while conserving main-thread tokens and reporting elapsed timing.
---

# Test

## Workflow

Spawn one subagent and treat it as the tester for the current repository. The tester must validate from the current working tree, preserve user changes, and avoid streaming verbose build or test output into the main conversation.

Use a prompt shaped like this, adjusted only for the current repository path and optional selector:

```text
You are the tester subagent for /absolute/path/to/repo.

Load these files into your context before running commands:
- build-tools/docs/build-system-design.md
- docs/handbook/getting-started-on-a-pr.md

Then load the repo's direnv environment and run the repository validation sequence from the repo root.

Validation command:
- If no test selector was requested, run `i && b && v`.
- If a test selector was requested, run `i && b && v <test selector>`.

Conserve tokens:
- Pipe the full combined command output to a timestamped log file under buck-out/tmp/agent-test-logs/.
- Do not paste verbose output into the conversation.
- Stay quiet while the validation command is running. Do not send progress updates, heartbeat messages, or "still running" notes.
- If the command passes, report only the commands run, the log path, elapsed timing, and a concise success summary.
- If the command fails, inspect the log with targeted tools such as tail, rg, and focused sed ranges. Report the failing command or phase, elapsed timing, the relevant error lines, and the log path. Include enough detail for the main agent to fix the issue without reading the entire log.

Do not modify source files unless explicitly asked to investigate and fix failures. Do not revert user changes.
```

## Tester Command

Instruct the tester to use a command equivalent to:

```bash
mkdir -p buck-out/tmp/agent-test-logs
log="buck-out/tmp/agent-test-logs/i-b-v-$(date +%Y%m%d-%H%M%S).log"
v_args=()
set -euo pipefail
start_epoch="$(date +%s)"
status=0
{
  command -v direnv
  direnv_env="$(direnv export bash)"
  eval "$direnv_env"
  command -v i
  command -v b
  command -v v
  if [ "${#v_args[@]}" -gt 0 ]; then
    i && b && v "${v_args[@]}"
  else
    i && b && v
  fi
} >"$log" 2>&1 || status=$?
end_epoch="$(date +%s)"
elapsed_seconds="$((end_epoch - start_epoch))"
printf 'status=%s\nlog=%s\nelapsed_seconds=%s\n' "$status" "$log" "$elapsed_seconds"
exit "$status"
```

Set `v_args` from the selector the user provided. Leave it empty when no selector was provided. For a single target selector, use one array element, for example `v_args=("//build-tools/tools/tests/node:node.service-artifact.contract.test")`. For selector flags, use one array element per shell argument, for example `v_args=(--selector project-closure --project projects/apps/pleomino)`. Keep the entire run redirected to the log in every case.

Run this from the repo root using `bash -lc` or `zsh -lc` so direnv can export the environment into the shell that runs validation. If `direnv export bash` says the directory is blocked, run `direnv allow` once for this checkout, rerun the command, and mention that in the tester report.

## Main-Agent Behavior

After spawning the tester, keep working on any non-overlapping task if one exists. Wait quietly for the tester when its result is needed to answer the user; do not send interim status updates just because validation is still running.

When the tester finishes:

- If validation passed, tell the user which validation command passed and include the log path and elapsed timing.
- If validation failed, summarize the failing phase, elapsed timing, and the relevant error snippet or diagnosis from the tester. Do not paste the whole log.
- If the tester could not run the sequence because direnv or another prerequisite was missing, report the exact missing prerequisite and the log path or command output used to determine it.
- Do not mark validation as successful unless the full selected validation sequence exited zero.

## Token Discipline

Prefer `rg`, `tail`, and narrow `sed -n` ranges when reviewing logs. Search first for high-signal patterns:

```bash
rg -n "error|failed|failure|exception|panic|timeout|Command failed|Exit code|FAIL|FAILED" buck-out/tmp/agent-test-logs/<log>
tail -n 200 buck-out/tmp/agent-test-logs/<log>
```

Only read broader ranges when the first failing signature lacks context.
