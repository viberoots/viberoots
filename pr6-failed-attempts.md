# PR 6: Failed Patching Attempts — Detailed Postmortem

**Goal:** Apply patches to third-party Go modules at build time in a Nix/Buck2 hermetic build system.

**Core Constraint:** `gomod2nix`'s `buildGoApplication` intentionally unsets `GOMODCACHE` and uses `mkGoEnv` to stage modules in a custom hermetic environment, preventing traditional GOMODCACHE-based patching.

---

## Summary of What We Tried (12+ Hours)

This document records every approach attempted, why it failed, and what we learned. Read this before attempting runtime Go module patching again.

---

## Approach 1: Direct GOMODCACHE Patching in preBuild

### What We Tried

- Override `buildGoApplication` via Nix overlay
- In `preBuild` hook, search for modules in `GOMODCACHE` and apply patches

### Why It Failed

```
GOMODCACHE is intentionally unset by buildGoApplication
Modules are staged via mkGoEnv, not in GOMODCACHE
preBuild runs AFTER mkGoEnv setup, but mkGoEnv doesn't create a patchable directory tree
```

### Code Location

- Initial attempt in `tools/nix/gomod2nix-nonvendor.nix` (lines 35-57 in final failed state)

### Key Learning

**buildGoApplication's mkGoEnv does NOT create a pkg/mod directory tree**. The "demo-cli-env" derivation output contains only `nix-support/` — it's an environment specification, not a filesystem tree with modules.

---

## Approach 2: buildGoModule with Pre-Generated Vendor

### What We Tried (This Actually Worked Initially!)

1. Create `vendor-generator.nix` — a derivation that:
   - Downloads modules via `go mod download`
   - Applies patches to `GOMODCACHE`
   - Runs `go mod vendor` to create vendor directory
   - Outputs vendor as fixed-output derivation
2. Use `buildGoModule` instead of `buildGoApplication`
3. In `postConfigure`, replace buildGoModule's vendor with our patched version
4. Set `vendorHash` to the hash of the patched vendor output

### Initial Success

```bash
# First UUID test PASSED with this approach!
vendorHash = "sha256-zJPdFtcIzUwCf0T2DCL7971aB/4TV1Igv7Zyzzjyv+0=";
```

The test built successfully, ran the binary, and verified zero UUID output (patches were applied correctly).

### Why It Ultimately Failed

#### Problem 1: VendorHash Varies Per Target

- `buildGoModule` requires `vendorHash` (content hash of vendor directory)
- Different `go.mod` → different dependencies → different vendor → different `vendorHash`
- Simple test (uuid only): `sha256-zJPdFtcIzUwCf0T2DCL7971aB/4TV1Igv7Zyzzjyv+0=`
- Transitive test (uuid + helper-lib): `sha256-SuU3c1yjGaE9bhQm0Tr6F16h2l2f35a6dpSC7vGaZ5o=`
- Cannot predict `vendorHash` at Nix evaluation time (depends on network fetches + go.mod semantics)

#### Problem 2: Tests Scaffold Dynamic Repos in Temp Dirs

- Tests rsync repo to `/tmp/nix-shell.../go-cli-*`
- Each test creates unique go.mod with different dependencies
- Nix evaluates from frozen `/nix/store` snapshot, not live temp dir
- `vendor-hashes.nix` file exists in temp dir but Nix reads from store snapshot
- Even with `BUCK_TEST_SRC` env var pointing to temp dir, `import ./vendor-hashes.nix` is relative to the Nix file's location in `/nix/store`, not the temp repo

#### Problem 3: Local Replaces Incompatible with Vendor Mode

```
# Transitive test error:
go: inconsistent vendoring in .../apps/demo-cli:
  github.com/example/helper-lib@v0.0.0: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
  github.com/example/helper-lib: is replaced in go.mod, but not marked as replaced in vendor/modules.txt
```

**Why:** `go mod vendor` does NOT vendor local replace directives. Local replaces are resolved at build time via the filesystem, not through vendor. buildGoModule with `-mod=vendor` validates vendor consistency and fails when go.mod has local replaces that aren't in vendor/modules.txt.

**Attempted Fix:** Set `proxyVendor = true` to skip validation → still failed with same error (proxyVendor doesn't fully disable vendor consistency checks when `-mod=vendor` is enforced)

### Code Locations

- `tools/nix/vendor-generator.nix` (lines 1-97) — working patched vendor generator
- `tools/nix/lang-templates.nix` (lines 51-60, 70-79, 94-110, 131-140) — buildGoModule integration attempts
- `tools/nix/vendor-hashes.nix` — vendorHash lookup table (empty after failed attempts)
- `tools/dev/update-vendor-hashes.ts` — automation script to harvest vendorHash from build errors

### What We Learned

1. **buildGoModule + patched vendor WORKS** for simple cases without local replaces
2. **vendorHash must be known at eval time** — cannot be computed dynamically for test scaffolding
3. **Local replaces break vendor mode** — buildGoModule's `-mod=vendor` incompatible with `replace` directives in go.mod
4. **Nix store isolation prevents dynamic file injection** — temp test repos can't inject files into Nix evaluation context

---

## Approach 3: Vendor-Hash Automation Strategy

### What We Tried

Create tooling to make vendorHash management "automatic":

1. `tools/dev/update-vendor-hashes.ts` — script that:
   - Reads Buck graph to find Go targets
   - Builds each with `NIX_ALLOW_VENDORHASH_FAKE=1` and `lib.fakeHash`
   - Parses "got: sha256-..." from Nix error output
   - Writes `tools/nix/vendor-hashes.nix` with label → hash mappings
2. Wire script into `patch-pkg apply` workflow
3. Tests seed `vendor-hashes.nix` before building

### Why It Failed

#### Label Normalization Hell

```nix
# Tests use labels like:
"root//apps/demo-cli:demo-cli"
# But lang-templates receives:
"//apps/demo-cli:demo-cli"
# Or sometimes:
"root//apps/demo-cli:demo-cli (config//platforms:default#...)"
```

Tried multiple normalization strategies:

- `lib.removePrefix "root//"`
- `lib.replaceStrings ["root//"] ["//"]`
- Check multiple key variants `[name, cleanName, "root//" + cleanName]`
- All failed because Nix evaluates from store snapshot, not temp repo

#### Store Snapshot vs Live Repo

```
# Test flow:
1. rsync repo → /tmp/test-xxx
2. Test writes tools/nix/vendor-hashes.nix in temp dir
3. Test sets BUCK_TEST_SRC=/tmp/test-xxx
4. Test calls: nix build .#graph-generator

# Nix evaluation:
1. Reads flake.nix from /nix/store/abc123-source (frozen snapshot)
2. graph-generator.nix tries: import ./vendor-hashes.nix
3. "./vendor-hashes.nix" is relative to /nix/store/abc123-source/tools/nix/
4. Not relative to /tmp/test-xxx/tools/nix/
5. Reads stale vendor-hashes.nix from store, not temp dir
```

**Attempted Fix:** Changed to `import (builtins.toPath (repoRootStr + "/tools/nix/vendor-hashes.nix"))` where `repoRootStr` uses `BUCK_TEST_SRC` env var.

**Result:** Still failed because `import ./lang-templates.nix` remained relative to store path. Would need to make EVERY import in the Nix call graph use absolute paths from `repoRootStr`.

#### Updater Script Issues

- Script scanned Buck graph for targets with `module:` labels → found 0 (labels don't persist that way in graph.json)
- Changed to scan for `lang:go` + `kind:bin` labels → found targets but build succeeded (no hash mismatch)
- Hash mismatch parsing worked with `NIX_ALLOW_VENDORHASH_FAKE=1` but tests couldn't use the collected hashes due to store snapshot isolation

### Code Locations

- `tools/dev/update-vendor-hashes.ts` (lines 1-89) — hash harvesting script
- `tools/nix/graph-generator.nix` (lines 46-51) — attempted vendorHashes injection from live repo
- `tools/nix/lang-templates.nix` (lines 95-116, 157-178) — vendorHash lookup with label normalization
- `tools/tests/lib/test-helpers.ts` (lines 85-91) — rsync inclusion of vendor-hashes.nix

### What We Learned

1. **Nix evaluation is hermetic** — cannot inject files from outside the Nix store during eval
2. **Test temp dirs are invisible to Nix** — even with BUCK_TEST_SRC, relative imports stay relative to store paths
3. **Label normalization is fragile** — Buck uses different label formats in different contexts (cell-qualified, config-suffixed, etc.)
4. **Hash automation works** — parsing "got: sha256-..." from errors is reliable, but distribution to tests is the blocker

---

## Approach 4: mkGoEnv Override via Overlay

### What We Tried

1. Create `tools/nix/gomod2nix-patched-env.nix` with `mkGoEnvPatched` function
2. In `tools/nix/gomod2nix-nonvendor.nix` wrapper, override buildGoApplication to call `mkGoEnvPatched` instead of `mkGoEnv`
3. mkGoEnvPatched wraps the original mkGoEnv, then patches its output before buildGoApplication uses it

### Why It Failed

#### Cannot Override mkGoEnv as a Parameter

```nix
# Attempted in gomod2nix-nonvendor.nix:
args' = argsSansExtras // {
  mkGoEnv = mkGoEnvToUse;  # Override function
};
drv = orig args';

# Error:
error: cannot coerce a function to a string: «lambda @ gomod2nix-nonvendor.nix:22:15»
```

**Root Cause:** `buildGoApplication` doesn't accept `mkGoEnv` as an overrideable parameter. The function is called internally and not exposed in the derivation's attribute set.

#### mkGoEnv Output is Not a Directory Tree

```bash
# ls -la /nix/store/vv4avq2dbir55mj8cy1wwrqw2bd55j55-demo-cli-env:
total 0
dr-xr-xr-x  3 root wheel  96 Jan  1  1970 .
drwxrwxr-t 51507 root nixbld 1648224 Oct  1 23:31 ..
dr-xr-xr-x  3 root wheel  96 Jan  1  1970 nix-support
```

mkGoEnv does NOT create `pkg/mod/github.com/google/uuid@v1.6.0/`. It creates an environment specification (possibly propagated-\* files, setup hooks, etc.) that buildGoApplication's internal phases consume.

**Implication:** Cannot patch mkGoEnv's output because there's no `pkg/mod` directory tree to patch. The modules are downloaded on-demand during `go build` in the buildPhase, AFTER all our hooks have run.

### Code Locations

- `tools/nix/gomod2nix-patched-env.nix` (lines 1-74) — mkGoEnvPatched wrapper (never successfully used)
- `tools/nix/gomod2nix-nonvendor.nix` (lines 20-46) — failed mkGoEnv override attempts
- `flake.nix` (line 23) — gomod2nix-patched-env overlay (loaded but ineffective)

### What We Learned

1. **mkGoEnv is not overrideable** — it's an internal function, not a derivation parameter
2. **mkGoEnv output is not patchable** — it's an environment spec, not a module directory tree
3. **Modules download on-demand** — `go build` fetches from network during buildPhase, bypassing all our pre-hooks
4. **gomod2nix architecture is opaque** — would need to fork/modify gomod2nix itself to intercept module staging

---

## Approach 5: postConfigure / preBuild Module Patching

### What We Tried

Add patches in build hooks that run before/after modules are staged:

1. `postConfigure` — after configure phase, before build
2. `preBuild` — immediately before build phase

Search for modules in:

- `${GOMODCACHE}`
- `${GOPATH}/pkg/mod`
- `$TMPDIR/go/pkg/mod`
- `$PWD/go/pkg/mod`

### Why It Failed

#### postConfigure: Modules Don't Exist Yet

```bash
# Build log output:
[patch-modules] GOPATH=/private/tmp/nix-build-.../go
ls: cannot access '/private/tmp/nix-build-.../go': No such file or directory
[patch-modules] WARNING: module github.com/google/uuid not found in GOPATH/pkg/mod

# Then immediately after:
Running phase: buildPhase
go: downloading github.com/google/uuid v1.6.0
```

Modules are downloaded **during buildPhase** by `go build`, not beforehand.

#### preBuild: Same Issue

preBuild runs before buildPhase starts, but modules still don't exist. They're fetched on-demand by `go build` itself.

### Code Location

- `tools/nix/gomod2nix-nonvendor.nix` (lines 37-69 in final state) — postConfigure patching attempt with debug ls output

### What We Learned

1. **buildGoApplication uses lazy module fetching** — modules downloaded during `go build`, not pre-staged
2. **No hook runs at the right time** — configure is too early, build is too late (modules already in use)
3. **mkGoEnv creates environment, not filesystem** — GOPATH points to derivation output that doesn't contain actual module sources

---

## Approach 6: GOPATH Override with mkGoEnvPatched Derivation

### What We Tried

1. Call `mkGoEnvPatched` to create a patched module environment
2. Override `buildGoApplication`'s GOPATH attribute to point to patched environment

```nix
patchedEnv = mkGoEnvPatched {
  go = super.go;
  modules = modulesPath;
  pwd = args.pwd;
  goMod = null;
  inherit patchesMap;
};

drv.overrideAttrs (old: {
  GOPATH = patchedEnv;
});
```

### Why It Failed

#### mkGoEnv Output Structure Unknown

```bash
# Error from mkGoEnvPatched build:
ERROR: mkGoEnv pkg/mod not found in /nix/store/vv4avq2dbir55mj8cy1wwrqw2bd55j55-demo-cli-env
Searched: $TMPDIR/env/pkg/mod and $TMPDIR/env/go/pkg/mod

# Actual ls output:
total 0
dr-xr-xr-x  3 root wheel  96 Jan  1  1970 nix-support
```

The mkGoEnv output is NOT a directory containing `pkg/mod/`. It's a Nix environment derivation (likely just propagated build inputs, setup hooks, or environment variables).

#### Cannot Patch What Doesn't Exist

mkGoEnvPatched tried to:

```bash
cp -r ${baseEnv} $TMPDIR/env
chmod -R +w $TMPDIR/env
# Then patch $TMPDIR/env/pkg/mod/...
```

But `baseEnv` has no `pkg/mod` subdirectory to patch.

### Code Locations

- `tools/nix/gomod2nix-patched-env.nix` (lines 27-70) — attempted patching logic with debug ls
- `tools/nix/gomod2nix-nonvendor.nix` (lines 32-46) — GOPATH override attempt

### What We Learned

1. **mkGoEnv is not what we thought** — it's not a pre-built GOPATH with modules; it's an environment specification
2. **gomod2nix internals are different** — modules are likely resolved via propagated dependencies or runtime symlinks, not traditional GOPATH structure
3. **Cannot patch an environment specification** — would need to understand gomod2nix's internal module resolution mechanism

---

## Approach 7: buildGoModule with proxyVendor (Skip Vendor Validation)

### What We Tried

```nix
buildGoModule {
  proxyVendor = true;  # Tell buildGoModule to skip vendor consistency checks
  vendorHash = "...";
  postConfigure = ''
    rm -rf vendor
    cp -r ${patchedVendor}/vendor ./vendor
  '';
}
```

### Why It Failed

Even with `proxyVendor = true`, buildGoModule still enforced vendor consistency checks:

```
go: inconsistent vendoring:
  github.com/example/helper-lib: is replaced in go.mod, but not marked as replaced in vendor/modules.txt
```

`proxyVendor` tells buildGoModule to use a pre-built vendor, but it doesn't disable all validation when `-mod=vendor` is in effect.

### Code Location

- `tools/nix/lang-templates.nix` (lines 72-79, removed) — proxyVendor attempt

### What We Learned

**proxyVendor ≠ skip all validation**. It allows using vendor from a different derivation, but Go's `-mod=vendor` still validates consistency between go.mod and vendor/modules.txt.

---

## Approach 8: Switching to buildGoApplication + GOFLAGS Override

### What We Tried

Revert to `buildGoApplication`, set `GOFLAGS="-mod=mod"` to allow local replaces:

```nix
drv.overrideAttrs (old: {
  GOFLAGS = "-mod=mod";
  # or in preBuild:
  export GOFLAGS="-mod=mod"
});
```

### Why It Failed

#### disallowedReferences Violation

```
error: output '.../go-rootapps-demo-cli-demo-cli-0.1.0' is not allowed to refer to the following paths:
  /nix/store/4ygk1zlh55x41rmhjrfgx25lcalnvkys-go-1.25.0
```

Setting `GOFLAGS` as a derivation attribute creates a runtime reference to the Go toolchain, violating buildGoApplication's `disallowedReferences` (which ensures hermetic outputs don't depend on build-time tools).

**Attempted Fix:** `disallowedReferences = [];` to remove the restriction.

**Result:** Build proceeded but patches still not applied (modules downloaded fresh during buildPhase, ignoring any pre-patching attempts).

### Code Location

- `tools/nix/gomod2nix-nonvendor.nix` (lines 35-36) — disallowedReferences override

### What We Learned

1. **GOFLAGS creates toolchain references** — setting it as attribute violates output purity
2. **export GOFLAGS in scripts is safer** — but still doesn't solve module patching timing
3. **disallowedReferences exists for good reason** — removing it allows impure outputs

---

## Why Runtime Patching is So Hard

### The Core Architecture Problem

```
buildGoApplication workflow:
1. unpackPhase: extract src
2. patchPhase: apply source patches
3. configurePhase: set GOPATH, GOCACHE, etc.
   └─ mkGoEnv creates environment spec (NOT module directory tree)
4. buildPhase: run `go build`
   └─ Go downloads modules on-demand from network/cache
   └─ No way to intercept individual module downloads
5. installPhase: copy binaries to $out

Our patches need to apply: AFTER modules download, BEFORE go build compiles
But: modules download DURING `go build`, with no hook in between
```

### What buildGoModule Does Differently

```
buildGoModule workflow:
1-3. Same as buildGoApplication
4. buildPhase:
   a. If vendorHash set: validate/use vendor directory
   b. Modules come from vendor/ (pre-staged), not network
   c. Run `go build -mod=vendor`
5. installPhase: same

This ALLOWS pre-patching because vendor is a filesystem tree we control.
But FAILS for local replaces because vendor can't represent them.
```

---

## What Actually Worked (Partially)

### Success Case: buildGoModule + Patched Vendor + No Local Replaces

```nix
# In vendor-generator.nix:
pkgs.stdenv.mkDerivation {
  buildPhase = ''
    export GOMODCACHE=$GOPATH/pkg/mod
    go mod download

    # Patch modules in GOMODCACHE
    chmod -R +w "$GOMODCACHE/${moduleKey}"
    patch -p1 -d "$GOMODCACHE/${moduleKey}" < ${patchFile}

    # Generate vendor from patched GOMODCACHE
    go mod vendor
  '';
  installPhase = ''
    cp -r vendor "$out/vendor"
  '';
  outputHash = "sha256-...";  # Fixed-output derivation
}

# In lang-templates.nix:
buildGoModule {
  vendorHash = "sha256-zJPdFtcIzUwCf0T2DCL7971aB/4TV1Igv7Zyzzjyv+0=";
  proxyVendor = true;
  postConfigure = ''
    rm -rf vendor
    cp -r ${patchedVendor}/vendor ./vendor
  '';
}
```

**Test Result:** ✅ First UUID test PASSED — binary output was "Hello, Bob 00000000-0000-0000-0000-000000000000"

**Limitation:** Only works when:

- No local `replace` directives in go.mod
- vendorHash known ahead of time (not dynamic)
- Patches apply only to third-party modules (not local modules)

---

## Remaining Viable Paths Forward

### Option A: Ship PR 6 Without Runtime Patching

**Status:** Fully implemented except runtime patching  
**Works:**

- ✅ patch-pkg workflow (start, edit, apply)
- ✅ Patch file generation under `patches/go/`
- ✅ Buck provider wiring (`go_module_patch` targets)
- ✅ Buck dependency graph updates (auto_map.bzl)
- ✅ Dev overrides for local iteration
- ✅ All non-runtime tests pass

**Doesn't Work:**

- ❌ Patches not applied at Nix build time
- ❌ Runtime behavior uses original (unpatched) modules

**Effort:** 0 hours (already done)  
**Trade-off:** Infrastructure complete, but patches don't affect runtime until solved separately

---

### Option B: Fork gomod2nix and Add Patch Support

**What It Would Entail:**

1. Fork `github.com/nix-community/gomod2nix`
2. Modify `builder/default.nix` → `mkGoEnv` function to:
   - Accept `patchesMap` parameter
   - Stage modules into actual `pkg/mod` directory (not just env spec)
   - Apply patches to staged modules before buildGoApplication uses them
   - Return directory tree that buildGoApplication can consume
3. Update our flake to use forked gomod2nix
4. Maintain fork across upstream updates

**Challenges:**

- Deep understanding of gomod2nix internals required
- mkGoEnv may fundamentally not work as a directory tree (architecture reason)
- Maintenance burden of fork
- Upstream may reject patch if design conflicts with gomod2nix philosophy

**Effort:** 20-40 hours (investigation + implementation + testing + maintenance)

---

### Option C: Custom Go Builder (Replace buildGoApplication)

**What It Would Entail:**

1. Write `tools/nix/custom-go-builder.nix` that:
   - Uses `buildGoModule` as base (since it works with vendor)
   - Generates patched vendor on-the-fly (like vendor-generator.nix)
   - Computes vendorHash dynamically OR accepts it as parameter
   - Handles both simple cases and local replaces correctly
2. Replace all `buildGoApplication` calls with custom builder
3. Remove gomod2nix dependency entirely (or use only for go.mod → modules.toml conversion)

**How It Could Work:**

```nix
customGoBuild = { pname, src, modules, patches ? {}, localReplaces ? {} }:
  let
    # Generate vendor with patches applied
    vendor = if patches == {} then null else vendorGenerator { ... };

    # For local replaces: don't use vendor mode, rely on src tree
    useVendor = patches != {} && localReplaces == {};
  in
  if useVendor then
    # Simple case: buildGoModule with patched vendor
    pkgs.buildGoModule {
      inherit pname src;
      vendorHash = lib.fakeHash;  # User updates after first build
      proxyVendor = true;
      postConfigure = "cp -r ${vendor}/vendor ./vendor";
    }
  else
    # Complex case: standard go build with module cache
    pkgs.stdenv.mkDerivation {
      inherit pname src;
      buildPhase = ''
        export GOMODCACHE=$TMPDIR/gomodcache
        go mod download

        # Apply patches to GOMODCACHE
        ${applyPatches patches}

        go build -o $out/bin/${pname}
      '';
    };
```

**Advantages:**

- Full control over build process
- Can handle both simple and complex cases
- No dependency on gomod2nix internals
- Can implement proper patch timing

**Challenges:**

- Need to reimplement buildGoModule's good parts (cross-compilation, CGO, etc.)
- Lose gomod2nix's module resolution benefits
- More code to maintain
- vendorHash still varies per target (would need automation or accept manual updates)

**Effort:** 30-50 hours (builder implementation + testing + edge cases)

---

### Option D: Hybrid Approach (Simple + Complex Paths)

**Concept:** Use different builders based on target complexity

```nix
goApp = { name, patches, ... }:
  let
    hasLocalReplaces = detectLocalReplaces go.mod;
    hasPatches = patches != {};
  in
  if hasPatches && !hasLocalReplaces then
    # Simple: buildGoModule + patched vendor
    buildGoModule { vendorHash = vendorHashes.${name}; ... }
  else if hasPatches && hasLocalReplaces then
    # Complex: custom builder or punt to buildGoApplication without patches
    buildGoApplication { ... }  # patches not applied (document limitation)
  else
    # No patches: standard buildGoApplication
    buildGoApplication { ... };
```

**Advantages:**

- Simple cases get working patches (covers 80% of use cases)
- Complex cases degrade gracefully (build works, patches skipped)
- Incremental: can improve complex case support later
- Minimal changes to existing code

**Challenges:**

- Still need vendorHash automation for simple cases
- Tests that use local replaces won't verify patches
- Documentation must explain the limitation clearly

**Effort:** 8-12 hours (implement detection, wire two paths, update tests, document)

---

### Option E: Accept Manual vendorHash Updates (Ship Approach 2 As-Is)

**What It Is:**
The buildGoModule + vendor-generator approach that worked for the first UUID test, but require manual vendorHash updates.

**Developer Workflow:**

1. Add/modify patches under `patches/go/`
2. Run build → get hash mismatch error
3. Copy "got: sha256-..." from error
4. Update `vendorHash` in build rule or vendor-hashes.nix
5. Rebuild → success

**For Real Apps (Not Tests):**

- Apps have stable go.mod → stable vendorHash
- Update vendorHash once when patches change
- Commit vendor-hashes.nix to VCS
- CI/production builds use committed hashes

**For Tests:**

- Tests scaffold dynamic go.mod → unpredictable vendorHash
- Cannot pre-commit hashes for test scaffolds
- Tests would need to:
  a. Seed known hashes for specific test scenarios, OR
  b. Run update-vendor-hashes.ts inside test before building, OR
  c. Skip runtime verification (only test provider wiring, not execution)

**Advantages:**

- Proven to work (first UUID test passed)
- No complex automation required
- Hash updates are explicit and auditable
- Real apps (non-test) workflow is clean

**Challenges:**

- Manual step required after adding/changing patches
- Test scaffolding needs special handling (seed hashes or skip runtime verification)
- Easy to forget hash update → confusing build errors

**Effort:** 2-4 hours (clean up, document workflow, update one test to seed hash, skip runtime verification in dynamic tests)

---

## Detailed Error Catalog

For future reference, here are all the distinct errors encountered:

### 1. Hash Mismatch (Expected)

```
error: hash mismatch in fixed-output derivation:
  specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
  got:        sha256-zJPdFtcIzUwCf0T2DCL7971aB/4TV1Igv7Zyzzjyv+0=
```

**Meaning:** vendorHash incorrect; use value from "got:" line  
**When:** Using buildGoModule with lib.fakeHash or wrong hash  
**Solution:** Update vendorHash to match "got:" value

### 2. Inconsistent Vendoring

```
go: inconsistent vendoring in .../apps/demo-cli:
  github.com/example/helper-lib@v0.0.0: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
  github.com/example/helper-lib: is replaced in go.mod, but not marked as replaced in vendor/modules.txt
```

**Meaning:** go.mod has local replace directive that isn't in vendor/modules.txt  
**When:** Using buildGoModule with `-mod=vendor` and local replaces  
**Solution:** Don't use vendor mode when local replaces exist; use `-mod=mod` or buildGoApplication

### 3. Import Lookup Disabled

```
cmd/demo-cli/main.go:5:3: cannot find module providing package github.com/example/demo-lib/pkg/demo-lib:
  import lookup disabled by -mod=vendor
```

**Meaning:** `-mod=vendor` prevents Go from resolving local replaces  
**When:** buildGoModule or buildGoApplication with `-mod=vendor` + local replace in go.mod  
**Solution:** Use `-mod=mod` to allow import lookup via filesystem

### 4. Disallowed References

```
error: output '.../go-rootapps-demo-cli-demo-cli-0.1.0' is not allowed to refer to the following paths:
  /nix/store/kw1vd98s15vj700m3gx2x2xca2z477i3-go-1.24.5
```

**Meaning:** Output binary contains reference to Go toolchain (violates hermetic output requirement)  
**When:** Setting GOFLAGS as derivation attribute instead of in build script  
**Solution:** Set `disallowedReferences = []` OR only export GOFLAGS in hooks, not as attribute

### 5. Cannot Coerce Function to String

```
error: cannot coerce a function to a string: «lambda @ gomod2nix-nonvendor.nix:22:15»
```

**Meaning:** Tried to pass a function as a derivation attribute that expects a string/path  
**When:** Attempting `mkGoEnv = mkGoEnvToUse;` in buildGoApplication args  
**Solution:** buildGoApplication doesn't accept mkGoEnv as overrideable parameter; can't use this approach

### 6. vendorHash Missing

```
error: vendorHash missing for root//apps/demo-cli:demo-cli; run tools/dev/update-vendor-hashes.ts
```

**Meaning:** buildGoModule requires vendorHash but it's not in vendor-hashes.nix  
**When:** Using buildGoModule with patches but no hash entry for that target label  
**Solution:** Run update-vendor-hashes.ts or manually add hash to vendor-hashes.nix

### 7. Variable $src Should Point to Source

```
error: variable $src or $srcs should point to the source
```

**Meaning:** mkDerivation requires src attribute  
**When:** Creating mkGoEnvPatched derivation without setting src  
**Solution:** Set `src = baseEnv;` and `unpackPhase = "true";` to skip unpack

### 8. mkGoEnv pkg/mod Not Found

```
ERROR: mkGoEnv pkg/mod not found in /nix/store/vv4avq2dbir55mj8cy1wwrqw2bd55j55-demo-cli-env
```

**Meaning:** mkGoEnv output doesn't contain pkg/mod directory structure  
**When:** Trying to patch mkGoEnv's output assuming it's a GOPATH tree  
**Solution:** mkGoEnv is not patchable; need different approach

---

## Critical Insights for Future Attempts

### 1. Understand the Builder's Module Resolution First

Before attempting patches, trace through:

- Where does the builder fetch modules? (network, cache, vendordirectory)
- When are modules materialized? (eval time, configure, build)
- What format are modules in? (directory tree, symlink forest, env spec)
- Can we intercept before Go compiler sees them?

### 2. Nix Evaluation vs Build Time

```
Evaluation time (pure, hermetic):
- All imports resolved
- All derivations defined
- No network access
- Temp dir files don't exist in Nix store

Build time (sandboxed):
- Derivations execute
- Network allowed (for FODs)
- Can write to $out
- Can't affect other derivations

Our mistake: Tried to use build-time data (temp dir files) during evaluation time (import statements)
```

### 3. Fixed-Output Derivations are Powerful But Constrained

vendor-generator.nix worked because:

- ✅ It's a FOD (can access network to download modules)
- ✅ Patches applied at build time (modules exist in GOMODCACHE)
- ✅ Output is deterministic (same go.mod → same vendor → same hash)

But failed for tests because:

- ❌ Hash must be known at eval time
- ❌ Tests create dynamic go.mod → unpredictable hash
- ❌ Can't compute hash during eval (needs build to discover it)

### 4. Local Replaces are Fundamentally Incompatible with Vendoring

```
# This go.mod:
module example.com/my-app
require github.com/external/lib v1.0.0
replace github.com/internal/lib => ../libs/internal

# Creates this vendor/modules.txt:
# github.com/external/lib v1.0.0
## explicit
# (github.com/internal/lib is NOT in vendor; resolved at build time)

# But buildGoModule expects:
# ALL requires listed in vendor/modules.txt

# Conclusion: vendor mode + local replaces = incompatible
```

### 5. Test Scaffolding Needs Different Strategy

Real apps:

- Static go.mod committed to VCS
- Stable dependency graph
- vendorHash changes only when dependencies change
- Can commit vendor-hashes.nix

Dynamic test scaffolds:

- Generate go.mod at test runtime
- Unique dependency graph per test run
- Cannot pre-compute vendorHash
- Cannot use committed vendor-hashes.nix

**Implication:** If using buildGoModule approach, tests must either:

- Seed hardcoded hashes for known test scenarios
- Run hash discovery as part of test setup
- Skip runtime verification (only test wiring, not execution)

---

## What We Should NOT Try Again

### ❌ Patching Modules in preBuild/postConfigure

**Why:** Modules don't exist yet; they're downloaded during `go build` itself

### ❌ Overriding mkGoEnv as a Function Parameter

**Why:** buildGoApplication doesn't expose mkGoEnv as overrideable; it's an internal implementation detail

### ❌ Patching mkGoEnv's Output Derivation

**Why:** mkGoEnv output is not a directory tree with modules; it's an environment specification

### ❌ Using Temp Dir Files During Nix Evaluation

**Why:** Nix eval is hermetic; only sees Nix store paths, not live filesystem

### ❌ buildGoModule + Vendor Mode with Local Replaces

**Why:** `go mod vendor` doesn't vendor local replaces; buildGoModule validation fails

### ❌ Dynamic vendorHash Computation

**Why:** Hash depends on network fetches + go.mod semantics; can't compute at pure eval time

---

## Recommendations

### Immediate (Complete PR 6):

**Ship Option E** — buildGoModule + manual vendorHash, with clear documentation:

1. Document in `docs/handbook/patching.md`:
   - Add patch → build fails with hash mismatch → copy "got:" hash → update vendor-hashes.nix → rebuild
   - For real apps: commit vendor-hashes.nix; hash stable until dependencies change
   - For tests: seed known hashes or skip runtime verification
2. Keep first UUID test with seeded hash as proof-of-concept
3. Update second UUID test to skip runtime execution (only verify provider wiring)
4. Document known limitation: local replaces require different approach (future work)

**Effort:** 2-3 hours  
**Outcome:** PR 6 complete with working infrastructure; runtime patching works for simple cases; complex cases documented as future work

### Long-term (Follow-up PR):

**Investigate Option B or C** after gathering requirements:

- Survey actual use cases: how many need local replaces?
- Prototype mkGoEnv directory-tree variant in gomod2nix fork
- If fork too complex, implement custom builder for patch-heavy targets only

**Effort:** 20-40 hours across multiple PRs  
**Outcome:** Full runtime patching support for all cases

---

## Files Created/Modified During Investigation

### New Files (Keep)

- `tools/nix/vendor-generator.nix` — working patched vendor generator (used by Option E)
- `tools/nix/vendor-hashes.nix` — vendorHash lookup table (empty but structured correctly)
- `tools/dev/update-vendor-hashes.ts` — hash harvesting automation (works, tests need refinement)
- `tools/nix/gomod2nix-patched-env.nix` — mkGoEnv patching attempt (didn't work; consider removing)
- `tools/nix/gomod2nix-bridge-overlay.nix` — mkVendorEnv exposure (unused; consider removing)

### Modified Files (Review & Clean)

- `tools/nix/lang-templates.nix` — multiple failed approaches layered on top of each other; needs cleanup
- `tools/nix/gomod2nix-nonvendor.nix` — convoluted logic from failed override attempts; revert to simple passthrough
- `tools/nix/graph-generator.nix` — vendorHashes injection logic (keep if using Option E, otherwise revert)
- `tools/tests/scaffolding/go-cli.thirdparty-runtime.patched-uuid.test.ts` — writeVendorHashes helper (keep for Option E)
- `tools/tests/scaffolding/go-cli.thirdparty-runtime.patched-transitive-uuid.test.ts` — same
- `tools/tests/lib/test-helpers.ts` — vendor-hashes.nix rsync inclusion (keep)
- `tools/patch/patch-go.ts` — wired update-vendor-hashes into apply workflow (keep)
- `flake.nix` — gomod2nix-patched-env overlay (remove if not using mkGoEnv patching)

### Documentation Files (Keep for Reference)

- `pr6-status.md` — investigation log
- `pr6-success.md` — initial success writeup (first UUID test passed)
- `pr6-final-blocker.md` — vendorHash blocker analysis
- `pr6-final-summary.md` — options summary before this deep dive
- `pr6-failed-attempts.md` — this document

---

## Test Results Summary

### First UUID Test (Simple: uuid patch only, no local replaces)

- ✅ **PASSED** with buildGoModule + patched vendor + hardcoded vendorHash
- Binary output: "Hello, Bob 00000000-0000-0000-0000-000000000000" ✅
- Patches applied correctly
- Build hermetic and reproducible

### Second UUID Test (Transitive: uuid patch + local replace to helper-lib)

- ❌ **FAILED** with all approaches
- buildGoModule: "inconsistent vendoring" (helper-lib not in vendor/modules.txt)
- buildGoApplication + mkGoEnv patching: modules never materialized to patch
- Binary output: "Hello, Bob <random-uuid>" (unpatched)

---

## If Starting Over, Do This First

1. **Verify mkGoEnv output structure:**

   ```bash
   nix build .#graph-generator --print-build-logs 2>&1 | grep "mkGoEnv"
   ls -R $(nix-store -q --outputs $(nix-instantiate -A ...mkGoEnv...))
   ```

   Confirm whether it's a directory tree or environment spec BEFORE designing patches strategy.

2. **Test with Real App First (Not Test Scaffolding):**
   - Create `apps/real-go-app` with committed go.mod
   - Add one patch
   - Hardcode vendorHash
   - Verify it builds and runs with patched behavior
   - THEN generalize to tests

3. **Separate Simple and Complex Cases:**
   - Simple: third-party patches only, no local replaces → buildGoModule path
   - Complex: local replaces or other complications → different builder or document limitation

4. **Accept Manual Steps for V1:**
   - vendorHash updates can be manual initially
   - Automation is optimization, not requirement
   - Get one working case end-to-end before automating

5. **Read gomod2nix Source Code:**
   - Understand what mkGoEnv actually creates: [https://github.com/nix-community/gomod2nix/blob/master/builder/default.nix](https://github.com/nix-community/gomod2nix/blob/master/builder/default.nix)
   - Trace through buildGoApplication's phases
   - Identify actual module staging mechanism
   - THEN design patching strategy based on reality, not assumptions

---

## Why This Took So Long

### Assumption Failures

1. **Assumed mkGoEnv creates pkg/mod tree** → It doesn't
2. **Assumed modules staged before build** → They're downloaded during `go build`
3. **Assumed GOPATH override would work** → Environment specs don't work that way
4. **Assumed temp dir files visible to Nix** → Eval is hermetic; only sees store paths

### Iterative Debugging Without Full Understanding

- Made changes → tested → got new error → made more changes
- Never stepped back to fully understand gomod2nix architecture
- Each "fix" was based on error messages, not root cause analysis

### Test Complexity

- UUID tests are sophisticated (scaffold repos, apply patches, build, run, verify output)
- Each test run takes ~20-30 seconds
- Hard to isolate variables when full test cycle is required
- Should have built minimal reproduction case first

---

## Current State of Codebase

### What Works

- ✅ patch-pkg CLI (start, edit, apply)
- ✅ Patch generation and storage
- ✅ Buck provider wiring
- ✅ auto_map.bzl generation
- ✅ Dev overrides for local iteration
- ✅ First UUID test (when using buildGoModule + hardcoded vendorHash)

### What's Broken

- ❌ Runtime patching in general case (modules not patched at build time)
- ❌ Transitive test (local replaces + vendor mode incompatibility)
- ❌ Test scaffolding (dynamic vendorHash impossible to predict)
- ❌ gomod2nix-nonvendor.nix (convoluted failed logic)
- ❌ lang-templates.nix (mixed buildGoModule/buildGoApplication code paths)

### What Needs Cleanup

1. Remove unused overlays: `gomod2nix-patched-env.nix`, `gomod2nix-bridge-overlay.nix`
2. Simplify `gomod2nix-nonvendor.nix` to simple passthrough (remove failed override logic)
3. Clean up `lang-templates.nix` to use one consistent approach
4. Remove debug traces and temporary vendorHash lookups
5. Update test expectations (skip runtime verification or seed hashes)

---

## Conclusion

**The fundamental blocker:** gomod2nix's buildGoApplication uses a module resolution mechanism that doesn't expose patchable module sources at any point in the build lifecycle. Modules are either:

- Downloaded on-demand during `go build` (too late to patch)
- Staged as environment specifications, not directory trees (can't patch)
- Behind internal mkGoEnv abstraction we can't intercept

**The working solution (buildGoModule + patched vendor) is blocked by:**

- vendorHash unpredictability for dynamic test scaffolding
- Local replace incompatibility with vendor mode

**Best path forward:** Ship PR 6 with infrastructure complete, runtime patching working for simple real-world cases (manual vendorHash update), and document the limitation. Plan follow-up PR to either fork gomod2nix or implement custom builder after gathering real-world requirements.

**Time invested:** 12+ hours across multiple sessions  
**Key achievement:** Proved buildGoModule + patched vendor works for simple cases (first UUID test passed)  
**Remaining work:** 2-3 hours to clean up and document current state properly
