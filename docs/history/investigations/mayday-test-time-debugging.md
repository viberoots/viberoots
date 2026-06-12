# Mayday test-time debugging summary

This is a historical performance investigation note. For current validation commands, use
`TESTING.md` and `docs/handbook/testing.md`: the ordinary PR loop is `i && b && v`, and the forced
full-suite command is `i && b && ALL_TESTS=1 v`.

## Current conclusion

We have a proven root-cause chain and a targeted fix.

The recent verify wall-time regression was not fixed by broad thread-count
tuning. It came from trying to manage a mixed workload with one broad Buck test
pass, then from an incomplete bounded-pass fix:

1. Deployment-owned `runInTemp` tests were a real contention class inside the
   broad shared pass.
2. Moving them into `verify:resource-limited` reduced target-duration
   contention, but the first implementation ran that pass serially before
   shared, so the saved work became additive wall time.
3. The first overlap attempt reused the same top-level Buck `--isolation-dir`
   for both passes. That did not really overlap: the delayed resource pass
   waited behind the shared `buck2 test` command.
4. True overlap requires distinct top-level Buck isolations per concurrent
   pass.
5. True overlap also must be staged late enough. Starting resource-limited at
   shared+240s still inflated shared/resource durations and missed the target.
6. Starting resource-limited at shared+900s with distinct pass isolations
   completed the full suite under 40 minutes.

The targeted code fix is:

- classify deployment temp-repo tests as `verify:resource-limited`;
- run non-isolated passes concurrently only with per-pass Buck isolations;
- for broad runs, start `shared` immediately and delay `resource-limited` by
  900s.

Completed proof run:

`/Users/kiltyj/Code/bucknix-fresh/buck-out/tmp/verify-logs/verify-2026-05-02T05-50-30-016Z-98467-0c7ba27b1da7f.log`

- `concrete=1270 pass_count=3 isolated_targets=15 resource_limited_targets=121 shared_targets=1134`
- isolated: `273s`, status `0`, `15/15`
- shared: `1946s`, status `0`, `1134/1134`, top-level iso
  `v-98467-1777701030463-shared`
- resource-limited: delayed by `900s`, `1112s`, status `0`, `121/121`,
  top-level iso `v-98467-1777701030463-resource-limited`
- `buck-test-passes`: `2285.794s` (`38.1m`)
- command-lock wait lines: `0`
- max load/process summary: `max_load1=61.11`, `max_processes=975`,
  `max_node=118`, `max_buck=103`, `max_nix=27`

This is the first completed run in the investigation that both passed and got
the Buck test phase back under 40 minutes.

## Determined without question

### Broad thread increases are not the fix

Do not restore `VERIFY_BUCK2_THREADS` to `20` or `30` as a standalone fix.

Evidence:

- Feb 9 baseline:
  `/Users/kiltyj/Code/bucknix-fresh/docs/history/build-system/logs/verify-2026-02-09T20-03-53-668Z-9970-7d1a04585c6af.log`
  finished `797` tests in `1239s` with `threads=30`.
- Current suite has `1270` concrete targets, so February-to-now target growth is
  real.
- Current `VERIFY_BUCK2_THREADS=20` run:
  `/Users/kiltyj/Code/bucknix-fresh/buck-out/tmp/verify-logs/verify-2026-05-01T22-07-50-207Z-84140-8b521a934c599.log`
  produced a load storm and was much slower for common targets:
  `max_load1=125.50`, `max_buck=84`, `max_node=117`, `max_nix=48`.
- The same parsed target set was about `2.10x` slower at `threads=20` than at
  `threads=8`.

The historical cap drop from `30 -> 20 -> 8` is a contributor to the
February-to-now gap, but broad fan-out is a proven current failure mode.

### Serial resource-limited scheduling did not improve wall time

Before the resource-limited split:

`/Users/kiltyj/Code/bucknix-fresh/buck-out/tmp/verify-logs/verify-2026-05-01T21-13-24-056Z-7429-add7797e44a68.log`

- isolated: `217s`
- shared: `2686s`
- `buck-test-passes`: about `48.4m`

After the initial split, but still serial:

`/Users/kiltyj/Code/bucknix-fresh/buck-out/tmp/verify-logs/verify-2026-05-02T00-39-24-467Z-88180-d78b56c1d1ff7.log`

- isolated: `238s`
- resource-limited: `553s`
- shared: `2141s`
- `buck-test-passes`: about `48.9m`

The split moved work out of shared, but serialized it before shared, so total
wall time did not improve.

### Same-isolation overlap was fake overlap

The staged run at:

`/Users/kiltyj/Code/bucknix-fresh/buck-out/tmp/verify-logs/verify-2026-05-02T04-56-26-046Z-85250-b764d94b3bea1.log`

used a 240s delayed resource start, but both pass commands shared
`--isolation-dir v-85250-1777697786484`.

Evidence:

- shared began with `threads=8`;
- resource-limited began with `threads=4`;
- resource-limited had `0` completions after `480s`;
- the log repeatedly printed `Waiting on Synchronizing buck2 internal state
[Waiting for command ... threads=8 ...] to finish`;
- the run was stopped because it could not prove overlap.

This proves concurrent process groups are not enough. Concurrent verify passes
must use distinct top-level Buck isolations.

### Early true overlap is still too much overlap

The per-pass-isolation run at:

`/Users/kiltyj/Code/bucknix-fresh/buck-out/tmp/verify-logs/verify-2026-05-02T05-15-08-207Z-93249-8904d2ba962e6.log`

used distinct pass isolations and delayed resource-limited by `240s`.

It proved the daemon-serialization fix worked:

- shared iso: `v-93249-1777698908651-shared`
- resource-limited iso: `v-93249-1777698908651-resource-limited`
- command-lock wait lines: `0`

But it missed the wall-time target:

- resource-limited took `1413s` versus `553s` in the serial post-split run;
- shared was already inflated enough that the lower bound was about `43.1m`;
- resource summaries reached `max_load1=85.10`, `max_buck=108`,
  `max_node=85`, `max_nix=30`;
- the run also produced broad-load-sensitive failures that passed when rerun
  alone.

Conclusion: per-pass isolation is required, but `240s` is too early for this
workload.

### A 900s staged start is proven under 40 minutes

The completed proof run with `VERIFY_RESOURCE_LIMITED_START_DELAY_SECS=900`
passed all targets and completed Buck test passes in `38.1m`.

This validates the default delay now encoded in
`build-tools/tools/dev/verify/verify-pass-scheduling.ts`.

Do not replace this with `240s` without a newer completed full-suite run that
beats `38.1m` and passes all targets.

## Ruled out without question

- **"It is just test count."** Not for the late-April/current regression. The
  recent target delta is much smaller than the wall-time jump, and full-suite
  target durations inflated under fan-out.
- **"Just raise shared threads."** Current `threads=20` is a proven load storm.
- **"The resource-limited split alone fixed it."** The serial split completed
  around `48.9m`, not faster.
- **"Overlap failed because overlap is impossible."** False. It failed first
  because same-isolation Buck commands serialized, and then because the
  resource lane started too early. Distinct isolations plus a 900s delay passed
  under 40.
- **"Seed staging/copy is the direct root cause."** Focused evidence showed
  seed copies around `0.6s`, not enough to explain the suite wall-time jump.

## Changes made

- Added `verify:resource-limited` scheduling support for deployment temp-repo
  tests.
- Added a bounded `resource-limited` pass with `threads=4`.
- Added per-pass Buck isolation for concurrent verify passes.
- Added broad-run staged start logic for `resource-limited`; default is now
  `900s`, with `VBR_VERIFY_RESOURCE_LIMITED_START_DELAY_SECS` or
  `VERIFY_RESOURCE_LIMITED_START_DELAY_SECS` as explicit overrides.
- Split scheduling helpers into
  `build-tools/tools/dev/verify/verify-pass-scheduling.ts` so
  `verify-passes.ts` stays below the 250-line methodology gate.
- Updated tests for pass planning, resource-limited labels, grouped execution,
  staged delay overrides, and dedicated Buck isolation names.
- Updated `docs/handbook/getting-started-on-a-pr.md` with the guardrail that
  concurrent verify passes need distinct Buck isolations and a staged start.

## Remaining work for under 30 minutes

The under-40 regression is fixed by scheduling. Getting under 30 minutes likely
requires reducing target-duration work, not broad fan-out:

- The current suite has `1270` concrete targets versus the Feb 9 baseline's
  `797`.
- Broad `threads=20`/`30` behavior is unsafe under the current workload mix.
- The successful run still spends `1946s` in the shared pass and `1112s` in the
  resource-limited pass after its delayed start.

The next under-30 investigation should target the biggest shared-pass target
duration families: scaffolding, Node/Nix test builds, Go/WASM, planner, and
remaining deployment tests that are intentionally left in shared.
