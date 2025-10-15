# install-deps.ts Recursion Issue — Investigation Notes

## Problem

Running `./tools/dev/install-deps.ts` while direnv is active causes recursive node process spawning, reaching 200+ processes within seconds.

## Observed Behavior

```bash
./tools/dev/install-deps.ts
Installing dependencies...
Done in 284ms
pnpm-store: up to date
[building node-modules...] ← recursion starts here

ps aux | grep node | wc -l
258  # and climbing rapidly
```

## Root Cause Hypothesis

When `install-deps.ts` runs `nix build .#node-modules`:
1. The nix build process evaluates the flake
2. If direnv is active in the environment, it might re-evaluate `.envrc`
3. That triggers the shellHook
4. The shellHook has `nix build` calls for buck2 (lines 49, 53 in devshell.nix)
5. Those trigger more evaluations → infinite recursion

## Failed Fix Attempts

### Attempt 1: Environment variables
- Set `IN_NIX_BUILD=1` and `NO_NODE_MODULES_LINK=1`
- **Failed:** Variables not reaching shellHook context

### Attempt 2: Unset DIRENV vars
- Delete `DIRENV_ACTIVE`, `DIRENV_DIR`, etc. before nix build
- **Failed:** Direnv still re-activates somehow

### Attempt 3: Guard ALL nix builds in shellHook
- Wrap buck2 binary fetches with `IN_NIX_BUILD` checks
- **Failed:** Still recursing

### Attempt 4: Unset direnv at start of main()
- Delete DIRENV vars at the very beginning of install-deps
- **Failed:** Still recursing (258+ processes)

## Why Guards Aren't Working

Possible reasons:
1. Environment variables aren't inherited by nix build subprocesses
2. Direnv re-activates based on pwd/shell context, not just env vars
3. The `.envrc` file itself is being loaded by something
4. There's a path through the code that doesn't check the guards

## Potential Solutions (NOT TESTED)

### Option A: Don't use direnv when running install-deps

```bash
# User runs this instead:
env -i HOME=$HOME PATH=$PATH ./tools/dev/install-deps.ts
```

**Pros:** Completely isolates from direnv  
**Cons:** User must remember special invocation

### Option B: Check for .envrc in nix build

Make the shellHook detect if it's being run during a nix build by checking `NIX_BUILD_TOP`:

```bash
if [ -n "${NIX_BUILD_TOP:-}" ]; then
  return 0  # We're in a nix build, skip ALL shellHook logic
fi
```

**Issue:** Tried this, didn't work.

### Option C: Don't build node-modules in install-deps

Just tell users to run:
```bash
nix build .#node-modules
ln -sfn $(nix build .#node-modules --no-link --print-out-paths)/node_modules node_modules
```

**Cons:** install-deps doesn't do what it's supposed to do

### Option D: Pure bash wrapper

Create a bash script that:
1. Unsets ALL direnv/nix shell context
2. Runs nix build in a truly clean environment
3. Symlinks the result

## Current Recommendation

**DO NOT commit any more "fixes" until we have a verified solution.**

The recursion issue needs to be solved by someone who can safely test (the user), not by blind commits.

## For the User to Test

Try this manual approach:

```bash
# Kill direnv completely for this session
unset DIRENV_ACTIVE DIRENV_DIR DIRENV_FILE DIRENV_DIFF DIRENV_WATCHES
export IN_NIX_BUILD=1 NO_NODE_MODULES_LINK=1

# Now run nix build
nix build .#node-modules --no-link --accept-flake-config

# Check process count - did it recurse?
ps aux | grep node | wc -l
```

If that works, then we know the issue is that my code isn't properly unsetting direnv before the nix build.

If it STILL recurses, then something else is triggering direnv (maybe nix itself?).

## Status

**PR 2 Core (Tests + Docs):** ✅ Complete and committed (`3c314ff`)  
**Recursion Fix:** ❌ NOT WORKING - do not commit until verified

The recursion issue is BLOCKING but separate from PR 2's main deliverables.

