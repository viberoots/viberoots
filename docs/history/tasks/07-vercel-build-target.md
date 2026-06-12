# 9. Vercel Build Target

**Tier:** Core Providers + Auth
**Priority:** 9 of 44
**Depends on:** none
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Validate, stabilize, and document the existing `node_vercel_next_artifact` Buck/Nix build target so Next.js apps reliably produce a hermetic `.vercel/output` artifact with a stable content-addressed identity.

## What

Add a hermetic Buck/Nix artifact path for Next.js apps that produces a Vercel Build Output API
artifact from a repo-owned build, so a console app can be built, hashed, admitted, and published
without relying on Vercel Git auto-builds or untracked local `.vercel` state.

The work spans several layers that must land together:

**Starlark macro — `node_vercel_next_artifact`** (`build-tools/node/defs_vercel.bzl`)
A new genrule-backed macro, analogous in shape to the existing `node_service_artifact`, that:

- Accepts a `vercel_config` pointing to the package-local `vercel.project.json` (schema
  `vercel-next-artifact@1`).
- Calls Nix via the shared `nix_calling_genrule_bootstrap` / `nix_calling_env_export_buck_graph_json`
  helpers (same pattern as `node_asset_stage` and `node_service_artifact`).
- Emits a `vercel-prebuilt/` output directory containing `.vercel/output` and
  `artifact-identity.json`.
- Stamps `kind:app`, `webapp:ssr`, `framework:next`, `deployable:app`,
  `deployment-component:ssr-webapp`, and `vercel:prebuilt` labels so deployment component
  extraction can identify it as an SSR webapp without per-app glue.
- Rejects ambient `.vercel` directories and undeclared `VERCEL_*` environment variables at build
  time, failing closed rather than silently consuming state outside the declared inputs.

**Nix derivation — `node-vercel-next`** (`build-tools/tools/nix/flake/packages/node-vercel-next.nix`)
A per-importer `stdenvNoCC.mkDerivation` that:

- Receives the hermetic `nodeWebapp` dist output from the existing `node-webapp` derivation family.
- Runs `build-tools/tools/vercel/next-artifact.ts` (a `#!/usr/bin/env zx-wrapper` script) to
  assemble the Vercel Build Output API v3 directory layout under `.vercel/output/`.
- Writes `viberoots.json` alongside the standard Vercel output files to record build provenance.
- Verifies `.vercel/output` and `artifact-identity.json` exist before the install phase.

**Artifact identity script — `build-tools/tools/vercel/next-artifact.ts`**
A zx-wrapper TypeScript script that:

- Reads and validates `vercel.project.json` (schema version, `framework: "nextjs"`,
  `runtime.nodeVersion`, declared `buildEnv`/`runtimeEnv` names).
- Enforces the closed-world invariant: fails on any ambient `.vercel` directory, fails on any
  `VERCEL` or `VERCEL_*` environment variable not explicitly declared in the config.
- Assembles the Build Output API v3 layout:
  - `config.json` (version 3, filesystem + catch-all route to `render.func`)
  - `functions/render.func/.vc-config.json` (runtime, handler, launcherType)
  - `functions/render.func/server/` and `functions/render.func/client/` (from `dist/`)
  - `static/` (from `dist/client/public`) and `static/_next/static/` (hashed chunks)
- Computes artifact identity as a SHA-256 over all file paths, executable bits, and bytes in
  sorted traversal order, prefixed `vercel-next:<hex>`.
- Writes `artifact-identity.json` (schema `vercel-next-artifact-identity@1`).
- Rejects symlinks and hardlinks in the output tree.

**Scaffold template — `ts/webapp-ssr-next`** (`build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/`)

- `TARGETS.jinja` includes `node_vercel_next_artifact(name = "vercel_artifact")` alongside the
  existing `:app` / `:app_raw` targets.
- `vercel.project.json.jinja` emits a declared-input config (schema version, project name,
  Node version, empty `buildEnv`/`runtimeEnv` lists).
- Generated apps can opt into the Vercel artifact target without changes to the existing SSR
  runtime contract.

**Deployment scaffold template — `deployment/vercel-next`** (`build-tools/tools/scaffolding/templates/deployment/vercel-next/`)

- `TARGETS.jinja` emits `vercel_next_webapp_deployment(...)` pointing at
  `//projects/apps/<name>:vercel_artifact`, with Vercel team/project, environment, lane policy,
  admission policy, `vercel-api-token` secret requirement scoped to the `publish` step, runtime
  config requirement, and an HTTP smoke check.
- `copier.yaml` requires `--component`, `--team`, and `--project`; fails before rendering when
  any of these are absent.

**Tests to add or verify present**

- Artifact identity stability: identical `dist/` bytes must produce identical `identity` values
  across two separate invocations.
- Fail-closed: ambient `.vercel/` directory must reject; undeclared `VERCEL_*` env must reject.
- Buck label query: `node_vercel_next_artifact` must carry all seven required labels; `srcs` must
  include `vercel.project.json`.
- Scaffold render: a generated `ts/webapp-ssr-next` app must include `node_vercel_next_artifact`
  and a valid `vercel.project.json`.
- Component extraction: `isSupportedComponentNode("ssr-webapp", ...)` must return true for the
  labeled artifact target.

**Docs to update**

- `build-tools/docs/scaffolding.md` — Vercel artifact mode section for `ts/webapp-ssr-next`.
- Node/webapp build docs — `.vercel/output` contract, difference between `pnpm run dev` and the
  Buck artifact path.
- `docs/history/plans/external-deployments-plan.md` — update if artifact target shape changes later PR
  boundaries.

## Why Now

The Vercel deployment provider (task #10) needs a stable, admittable artifact reference as its
sole publish input. Without this build target there is no repo-produced artifact to admit: the
only alternative is Vercel Git auto-builds, which bypass the repo's immutable artifact admission
model, SprinkleRef secret runtime, and auditable deployment records. This task is the prerequisite
that unlocks the entire external Vercel deployment path.

## Risks

**Vercel CLI / ambient state leakage.** The Vercel CLI reads project-local `.vercel/` directories
and user-home config by default. If the build driver ever shells to the Vercel CLI rather than
writing the Build Output API layout directly, ambient state can silently invalidate hermeticity
without a visible build error.

**Next.js build output variance.** Next.js can embed timestamps, random chunk hashes, or
environment-dependent file contents. If the `dist/` input to the artifact script is
non-deterministic then `artifact-identity.json` will differ across rebuilds of the same source,
breaking immutable artifact reuse.

**Schema coupling.** The Vercel Build Output API v3 contract (layout, `.vc-config.json` fields,
static routing) is a third-party contract. A Vercel platform change that makes the assumed
`render.func` shape invalid would silently produce deployed-but-broken artifacts unless there is
an end-to-end smoke test.

**Nix derivation filter breadth.** The `filterRepo` function used in `node-vercel-next.nix` must
exclude build artifacts (`buck-out/`, `node_modules/`) from the repo snapshot. An overly broad
filter wastes derivation input hash stability; an overly narrow one may miss source files.

## Trade-offs

**Write the Build Output API layout directly vs. shelling to `vercel build --prebuilt`.** Writing
the layout directly (the chosen approach) means no Vercel CLI dependency, no ambient home-directory
reads, and fully hermetic Nix derivation inputs. The cost is that the layout logic in
`next-artifact.ts` must stay aligned with Vercel's Build Output API v3 spec manually; upstream
CLI changes do not auto-propagate.

**Single `render.func` catch-all vs. per-route functions.** The current assembly uses one function
(`render.func`) with a catch-all route. This covers SSR Next.js correctly but does not support
Vercel's per-route edge functions or ISR. Adding those shapes later would require a schema version
bump and a new Nix derivation variant; they are out of scope here.

**Artifact identity from finalized output bytes vs. from source fingerprint.** Hashing the
finalized `.vercel/output` bytes (the chosen approach) means identity is proof of the exact bytes
Vercel will receive, not a claim about the source that produced them. This is intentional: it
satisfies the immutable artifact admission contract. The trade-off is that a source change that
produces identical output (e.g., a comment edit stripped by the bundler) does not generate a new
identity, which is correct behavior.

## Considerations

**`vercel.project.json` is the sole declared input surface.** All Vercel metadata (project name,
Node version, declared env names) must be in this file. The macro takes `vercel_config` as an
explicit `srcs` entry so Buck can track it for invalidation. There is no fallback to reading
`.vercel/project.json`, user-home Vercel config, or ambient `VERCEL_PROJECT_ID` / `VERCEL_ORG_ID`
variables.

**Label parity with `node_service_artifact`.** The `node_service_artifact` macro (the closest
existing analog) stamps `kind:app`, `service:node`, `deployable:app`,
`deployment-component:service`. The `node_vercel_next_artifact` macro stamps the same `kind:app`
and `deployable:app` but uses `webapp:ssr`, `framework:next`, `deployment-component:ssr-webapp`,
and `vercel:prebuilt` to distinguish the component kind for the deployment extraction layer.

**Nix derivation wiring mirrors `node-webapp`.** The `node-vercel-next.nix` derivation consumes
the output of `nodeWebapp.${attr}` (the per-importer `node-webapp` derivation) as a pure Nix
input, exactly as `node-vercel-next.nix` already does in the repo. The `WORKSPACE_ROOT` env
override path (for local non-sandboxed runs) follows the same pattern used by `node-webapp` and
`deployment-control-plane-image.nix`.

**`global_nix_inputs()` stamping.** Per the design principle in `build-system-design.md`,
`node_vercel_next_artifact` is a macro that directly calls Nix and must stamp
`global_nix_inputs()` via `wire_global_nix_inputs(...)` from
`//build-tools/lang:nix_calling_macros.bzl`.

**Template anti-drift contracts.** Adding `ts/webapp-ssr-next` and `deployment/vercel-next` as
scaffold templates requires:

1. Template root directories and `meta.json` files to be present.
2. `gen-template-manifest-artifacts.ts` to be re-run to refresh generated taxonomy surfaces.
3. Parity/runtime contract tests (`template-taxonomy.parity-contract.test.ts`,
   `template-taxonomy.runtime-contract.test.ts`) to pass before merge.
4. Template-owned tests to carry `template:smoke` or `template:contract` classification labels
   and explicit `template_inputs` pointing into the template root.

**`scaf new deployment vercel-next` requires three inputs.** The `deployment/vercel-next` copier
template must fail before rendering when `--component`, `--team`, or `--project` are absent.
This matches the existing `deployment/cloudflare-pages` pattern that requires `--component`,
`--account`, and `--project`.
