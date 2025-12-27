## Logging enhancement: “follow latest run” behavior for `l` / `s`

This document captures a proposed improvement to the `tail-log` UX: when `l` (or `s`) is started with the default “monitor latest run” behavior (no PID argument), it should automatically switch to the newest verify log when a new `verify` run starts. This is intended to make `l`/`s` usable as a long-running “dashboard” process that you can leave running across multiple verify invocations.

The design below incorporates two important constraints:

- When “monitoring latest run” in **status watch mode**, switching to a new log must compute counters from the **full log** for accuracy.
- When called with an **explicit PID**, the watcher must **not** switch to newer runs; it should end when the run for that PID ends. No switch events/notices are required.

### Terms

- **Verify lock**: `buck-out/tmp/verify-lock/` containing `pid` and `log`. This is authoritative for the current active verify run (lock-first).
- **Latest log**: `buck-out/tmp/verify-logs/latest.log` symlink pointing to the most recent verify log file.
- **Concrete log path**: the resolved (non-symlink) path to the actual `.log` file.
- **Selection**: what the user asked for (latest vs PID).
- **Resolution**: the concrete log file (and optionally PID) that selection maps to at a given moment.

### Goals and user-facing semantics

#### Default selection (“latest”)

When invoked with no PID argument:

- **If a verify run is active** (lock PID is alive), `l`/`s` should use the log pointed to by the lock (lock-first).
- **If no verify run is active**, `l`/`s` should use `verify-logs/latest.log` (or a newest-log fallback if the symlink is missing).
- **If a new verify run starts while `l`/`s` is running**, the process should seamlessly switch to the new run’s log.

No switch event lines are necessary; the goal is “always show the latest run.”

#### Explicit PID selection

When invoked with a PID:

- The tool must bind to that PID’s log and **never switch** to other runs.
- In status watch mode (`--status -w`), it should **exit when that PID’s run ends** (after printing the final status once).
- In tail mode (non-`--status`), we can either keep the current tail-until-interrupted behavior or optionally exit when the PID exits; the requirement above only mandates the status behavior.

### Resolution algorithm (lock-first)

This describes how “latest” resolves on each refresh tick.

#### `latest` resolution

1. If `buck-out/tmp/verify-lock/pid` exists and that PID is alive:
   - Use `buck-out/tmp/verify-lock/log` as the log path (authoritative).
   - The resolved run is considered **running**.
2. Else, if `buck-out/tmp/verify-logs/latest.log` exists:
   - Resolve the symlink to a concrete log path and use it.
   - The resolved run is considered **completed**.
3. Else, best-effort fallback:
   - Select the newest `buck-out/tmp/verify-logs/verify-*.log` by mtime if present.
4. Else:
   - No run is available; return a “no runs found” state.

#### `pid` resolution

Resolve once at startup:

1. If the lock PID matches the requested PID, use lock `log`.
2. Else look for `buck-out/tmp/verify-logs/by-pid/<pid>.log`.
3. Else legacy fallback if needed.

If the PID is not alive:

- If the log exists, print status once and exit.
- If the log does not exist, error.

### Switching behavior

Switching is only allowed in `latest` mode.

Maintain:

- `current_log_path` (concrete path)
- optional `current_pid` (if tied to lock)

On every tick, compute `next_log_path` using the resolution algorithm above.

If `next_log_path != current_log_path`:

- Switch by setting `current_log_path = next_log_path` and resetting any per-log state (e.g. redraw line counts for TTY mode).
- Do not emit explicit “switched” messages (per requirement).

### Status watch mode (`--status -w` / `s`)

#### Full-log accuracy requirement

On each tick:

- Read the **full log file** and recompute counters from scratch.
- This ensures correctness even if we switch to a different log file mid-watch.

This also implies we must not carry parsing offsets from the prior log into the new one.

#### `latest` status watch

Loop:

- Resolve `next_log_path` (lock-first).
- If it differs, switch.
- Compute status from the full log.
- Sleep for the polling interval.

#### `pid` status watch

Loop:

- If PID is alive, compute status from the full log and sleep.
- If PID is not alive, compute status once and exit.

### Tail mode (non-`--status`)

This is optional and can be implemented later, but the same selection semantics apply:

- `latest` mode should restart the `tail -f` subprocess when the resolved log path changes.
- `pid` mode should never switch.

### JSON / NDJSON requirements

When `--json` is used:

- Output must be **NDJSON**: one JSON object per line.
- In `--json -w` mode, emit **exactly one JSON object per tick** (no extra “switch” events).
- A “switch” is observable by a change in the `log` field across ticks.

In error states (e.g. missing log), emit a single JSON object with an `error` field; still one line.

### Multiple concurrent verify runs

The selection is lock-first by design:

- If multiple runs exist (e.g. if concurrency is enabled), “latest” is defined as “whatever the lock says is active.”
- Completed logs can still be inspected via explicit PID mode or by directly tailing a chosen log file.

### Acceptance criteria

- **Latest mode switches automatically** when a new verify run starts (lock/log changes).
- Status watch uses **full log** after switch and produces accurate counters immediately.
- Explicit PID mode **never switches** and exits when that PID’s run ends (status watch).
- JSON mode remains **NDJSON**: one object per line, one object per tick.
