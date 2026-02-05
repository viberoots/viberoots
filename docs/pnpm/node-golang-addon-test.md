## Node Golang Addon — End‑to‑End Test Design (user‑flow realistic)

I’m designing a single, self‑contained E2E test that exercises a real user flow: scaffold a Node package backed by a Go c‑archive and a C N‑API addon, generate the minimum glue, produce an importer lockfile, build the test derivation, and validate runtime behavior. The design follows the repository’s methodology and build system principles, and mirrors proven patterns from existing Node addon tests.

### Scope

- Scaffold `projects/libs/<name>`, `projects/libs/<name>-go`, `projects/libs/<name>-native` via `scaf new node go-addon`.
- Generate an importer lockfile for the Node package, update the PNPM fixed-output digest mapping, and warm caches.
- Build the Nix `node-test.<importer>` derivation for the importer and validate the test report.
- Validate the addon’s loader path and a simple call that crosses Node → C N‑API → Go C API.

Out of scope: performance measurements, multi‑importer scenarios, and platform‑specific linker diagnostics beyond compilation/link success.

### Completion criteria

- The test reliably passes on aarch64‑darwin, aarch64‑linux, x86_64‑linux.
- A scaffolded project’s Node test derivation builds and its report exists (non‑empty).
- The addon function (e.g., `add(2, 3)`) succeeds from Node code.
- Glue generation steps are deterministic (no unintended diffs on re‑run).

### Components and dependencies

- CLI: `scaf` to create the three sibling packages.
- Buck2 + Nix planner: `nix_cpp_node_addon` links the Go c‑archive exposed by `nix_go_carchive`.
- Node importer workflow: PNPM lockfile for `projects/libs/<name>`; `build-tools/tools/dev/update-pnpm-hash.ts` for FOD alignment.
- Test helper: `build-tools/tools/tests/lib/test-helpers.ts` (`runInTemp`) to run in an isolated temp repo.

### Test location and naming

- File: `build-tools/tools/tests/scaffolding/node-go-addon.nix-node-test.pass.test.ts`
- One test per file, zx + node:test runner (repo convention).

### Runner and environment

- The test uses `runInTemp` to rsync a clean copy of the repo into a temp dir and generate minimal Buck config.
- It sets `TEST_NEED_DEV_ENV=1` so the helper prepares a usable dev shell for Buck/Nix inside the temp repo.
- It does not modify PATH; it relies on the dev shell environment.

### High‑level flow (phases)

1. Scaffold
2. Lockfile + mapping + cache warmup
3. Build `node-test.<importer>` via Nix
4. Validate runtime and reports
5. Optional glue smoke via Buck (graph export + auto_map) for determinism checks

---

## Step‑by‑step design

### Phase 1 — Scaffold

- Init a git repo (some glue helpers expect a repo, and pure Nix snapshots read committed files).
- Run: `scaf new node go-addon demo --yes`
- Assert presence of:
  - `projects/libs/demo/package.json`, `projects/libs/demo/src/index.ts`, `projects/libs/demo/TARGETS`
  - `projects/libs/demo-go/pkg/addon/addon.go`, `projects/libs/demo-go/TARGETS`
  - `projects/libs/demo-native/src/binding.c`, `projects/libs/demo-native/TARGETS`
- Commit scaffold output so Nix flake snapshots see the importer.

Measurable checkpoints:

- All listed files exist.
- `git commit` succeeds with a staged scaffold.

### Phase 2 — Lockfile + FOD alignment + cache warmup

- Importer path: `projects/libs/demo` (sanitized id: `projects_libs_demo`).
- If missing, generate lockfile for the importer using Nix‑provided PNPM (lockfile‑only, no install):

```bash
bash --noprofile --norc -c '
  set -euo pipefail
  mkdir -p "projects/libs/demo/.pnpm-home" "projects/libs/demo/.pnpm-store"
  export PNPM_HOME="projects/libs/demo/.pnpm-home"
  nix run .#pnpm --accept-flake-config -- config set store-dir "projects/libs/demo/.pnpm-store"
  nix run .#pnpm --accept-flake-config -- \
    install --filter "./projects/libs/demo" --lockfile-only --prod=false \
    --ignore-scripts --lockfile-dir "./projects/libs/demo" --dir "./projects/libs/demo"
'
```

- Commit the `pnpm-lock.yaml`.
- Update fixed‑output digest mapping for the importer:

```bash
zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile projects/libs/demo/pnpm-lock.yaml
```

- Warm PNPM store and Node modules caches (10‑minute external timeouts are acceptable for single builds):

```bash
bash --noprofile --norc -c '
  timeout 300s nix build ".#pnpm-store.libs_demo"   --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1
  timeout 300s nix build ".#node-modules.libs_demo" --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1
'
```

Measurable checkpoints:

- `projects/libs/demo/pnpm-lock.yaml` exists and is committed.
- `update-pnpm-hash.ts` finishes without errors.
- Both warmup builds complete successfully.

### Phase 3 — Build importer’s Node tests (derivation)

- Build:

```bash
bash --noprofile --norc -c '
  timeout 300s nix build ".#node-test.libs_demo" --impure --no-link --accept-flake-config --print-out-paths
'
```

- Expected behavior:
  - The build chains through `nix_cpp_node_addon` and links the Go c‑archive provided via planner (`T.goCArchive`) into the addon.
  - The Node test runner executes the scaffolded unit test which calls the exported addon function (e.g., `add(2, 3) = 5`).

Measurable checkpoints:

- The `nix build` returns a non‑empty out path.
- The out path contains a `report/` directory with at least one report artifact (e.g., JUnit XML).

### Phase 4 — Runtime validation (loader path + override)

- Sanity that the loader uses a stable path (`native/<addon_name>.node`) and respects `ADDON_PATH`:

```bash
node -e "const { add } = await import('./projects/libs/demo/dist/index.js').catch(()=>({})); if (typeof add !== 'function') process.exit(2); if (add(2,3) !== 5) process.exit(3);"
```

- Optionally, re‑run with:

```bash
ADDON_PATH=./projects/libs/demo/native/demo_addon.node node -e "/* same check */"
```

Measurable checkpoints:

- The script exits 0 with and without `ADDON_PATH` set.

### Phase 5 — Optional glue smoke (Buck path)

These are not required to build the `node-test` derivation, but they help catch drift:

- Export graph and generate auto_map:

```bash
node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json
node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl
```

- On a second run, assert no diffs:

```bash
git diff --exit-code
```

Measurable checkpoints:

- `build-tools/tools/buck/graph.json` and `third_party/providers/auto_map.bzl` exist.
- Re‑running the two commands yields no diffs.

---

## Guardrails and constraints

- Do not modify PATH in tests; rely on the dev shell to provide tools.
- Use zx TypeScript and `node:fs/promises` in helpers; do not assume `fs-extra` before dependencies exist.
- Keep exactly one test per file so Buck controls parallelism.
- Prefer external timeouts when invoking `nix build` directly for single long‑running steps.

---

## Proposed test skeleton (zx)

This sketch shows only the core operations; the actual file will match the repository test patterns and helper imports.

```ts
#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";

process.env.TEST_NEED_DEV_ENV = "1";

test("node go-addon: scaffold, build addon, and pass nix_node_test", async () => {
  await runInTemp("node-go-addon-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    const env = {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      INSTALL_LOCK_SKIP: "1",
      NIX_PNPM_FETCH_TIMEOUT: "300",
    } as Record<string, string>;

    await $`git init`;
    await $`scaf new node go-addon demo --yes`;
    // Existence checks (Node, Go, Native)
    for (const p of [
      "projects/libs/demo/package.json",
      "projects/libs/demo/src/index.ts",
      "projects/libs/demo/TARGETS",
      "projects/libs/demo-go/pkg/addon/addon.go",
      "projects/libs/demo-go/TARGETS",
      "projects/libs/demo-native/src/binding.c",
      "projects/libs/demo-native/TARGETS",
    ]) {
      if (!(await exists(path.join(tmp, p)))) throw new Error(`missing ${p}`);
    }

    // Commit scaffold
    await $`bash -lc 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    // Ensure importer lockfile
    const importer = "projects/libs/demo";
    const sanitized = "libs_demo";
    const lockfile = path.join(importer, "pnpm-lock.yaml");
    let hasLock = await fsp
      .access(path.join(tmp, lockfile))
      .then(() => true)
      .catch(() => false);
    if (!hasLock) {
      await $({
        stdio: "inherit",
        env,
      })`bash --noprofile --norc -c 'set -euo pipefail; mkdir -p "${tmp}/${importer}/.pnpm-home" "${tmp}/${importer}/.pnpm-store"; export PNPM_HOME="${tmp}/${importer}/.pnpm-home"; nix run ${tmp}#pnpm --accept-flake-config -- config set store-dir "${tmp}/${importer}/.pnpm-store"; nix run ${tmp}#pnpm --accept-flake-config -- install --filter "./${importer}" --lockfile-only --prod=false --ignore-scripts --lockfile-dir "./${importer}" --dir "./${importer}"'`;
      hasLock = await fsp
        .access(path.join(tmp, lockfile))
        .then(() => true)
        .catch(() => false);
    }
    await $({
      env,
    })`bash -lc 'git -C ${tmp} add ${lockfile} && git -C ${tmp} commit -m "chore(test): add importer lockfile"'`.nothrow();

    // Update FOD mappings and warm caches
    await $({
      stdio: "inherit",
      env,
    })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;
    await $({
      stdio: "inherit",
      env,
    })`bash --noprofile --norc -c 'timeout 300s nix build "${tmp}#pnpm-store.${sanitized}" --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;
    await $({
      stdio: "inherit",
      env,
    })`bash --noprofile --norc -c 'timeout 300s nix build "${tmp}#node-modules.${sanitized}" --impure --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;

    // Build Node tests for importer
    const out = await $({
      stdio: "pipe",
      env,
    })`bash --noprofile --norc -c 'timeout 300s nix build "${tmp}#node-test.${sanitized}" --impure --no-link --accept-flake-config --print-out-paths'`;
    const outPath =
      String(out.stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop() || "";
    if (!outPath) throw new Error("node-test out path empty");
    const reportDir = path.join(outPath, "report");
    const entries = await fsp.readdir(reportDir).catch(() => []);
    if (entries.length === 0) throw new Error("node-test report empty");
  });
});
```

---

## Risks and mitigations

- CGO and platform flags: the flake‑based `node-test.<importer>` build hides Buck platform details and still links the Go c‑archive correctly through the planner. If a Buck‑only path is needed, define a CGO‑enabled platform target and pass it via `--config build.default_platform=//:<cgo_platform>` during `buck2 build`, but this E2E prefers the proven flake path used by other addon tests.
- Lockfile generation: time‑boxed using an external timeout. The test commits the lockfile to make derivations cacheable and deterministic.
- Provider/auto_map drift: covered by the optional glue smoke (no diffs on re‑run).

---

## References

- `docs/pnpm/node-golang-addon.md` (scaffold architecture and acceptance)
- `build-tools/docs/build-system-design.md` (Buck2 orchestrator, Nix dynamic derivations, patching invariants)
- `docs/handbook/getting-started-on-a-pr.md` (dev shell, build/test commands, glue steps)
- `build-tools/tools/tests/lib/test-helpers.ts` (temp repo setup, dev env export)
