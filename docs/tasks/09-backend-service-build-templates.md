# 11. Backend Service Build Template(s)

**Tier:** Developer / Stakeholder Enablement
**Priority:** 11 of 44
**Depends on:** none
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Add a service scaffold template so new backend services get a ready-to-build entrypoint, health endpoint stub, Buck target, and test scaffold with a single `scaf new` command.

## What

Add a `go/service` Copier template under
`build-tools/tools/scaffolding/templates/go/service/` that produces a buildable, testable
Go HTTP service wired into the existing Buck2 + Nix build system.

The template family has two connected pieces:

**1. `go/service` scaffold** — `scaf new go service <name>` stamps
`projects/apps/<name>/` with:

- `go.mod` and an empty `go.sum` using the repo's module naming convention.
- `cmd/<name>/main.go` — server entrypoint that reads `PORT` from the environment
  and starts an HTTP listener.
- `internal/health/health.go` — `/healthz` handler returning `{"ok":true,
  "service":"<name>"}`, exercised by an auto-wired `_test.go` alongside it.
- `TARGETS` — loads `//build-tools/go:defs.bzl` and declares a `nix_go_binary`
  target labeled `lang:go`, `kind:bin`, and `deployment-component:service`, plus a
  `service.runtime.json` source input that carries the runtime contract to
  downstream deployment tooling.
- `service.runtime.json` — a version-stamped JSON file analogous to the
  `node-service-runtime@1` schema in `ts/service`, declaring `serviceName`,
  `productionCommand`, health path and port, `runtimeConfig` keys (at minimum
  `PORT`), and an empty `secretRequirements` list.
- `README.md.jinja` — rendered with next-step instructions: run glue
  (`export-graph → sync-providers → gen-auto-map`), then `buck2 build` and
  `buck2 test`.
- `copier.yaml` with variables `name`, `module`, `org`, `host`, `go_min`
  (default `1.22`), `description`, and `license`, matching the conventions
  established by `go-templates-phase-1-design.md`.
- `meta.json` with `language: "go"`, `template: "service"`, help usage, notes,
  and examples consumable by `scaf help new go service` and `scaf validate all`.

**2. Template taxonomy registration** — add `"service"` to the `"go"` array in
`build-tools/tools/scaffolding/scaf/templates/generated/template-taxonomy.generated.ts`
and `build-tools/tools/scaffolding/resolver.json` (destination
`projects/apps/{name}`), then regenerate derived surfaces:

```
node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts
```

The regenerated outputs include `template-taxonomy.generated.ts`,
`template_taxonomy_adapter.bzl`, and the resolver JSON so that
`scaf templates go` shows `service`, parity contracts pass, and
template-only test selection works when `go/service` template files change.

**Tests to be added:**

- A smoke test in `build-tools/tools/tests/scaffolding/` (zx, single test per
  file) that RSyncs the repo to a temp directory, runs `scaf new go service
  demo-svc`, runs glue steps, builds `//projects/apps/demo-svc:demo-svc` with
  Buck2, and runs auto-wired tests — mirroring the existing
  `go-lib.scaffold-and-build.test.ts` pattern.
- A runtime contract test asserting `service.runtime.json` is present, parses
  correctly, and contains required fields (`serviceName`, `productionCommand`,
  `health.path`, `health.port`).
- A Buck cquery test proving the generated `:demo-svc` target carries
  `deployment-component:service` and `kind:bin` labels, making it extractable by
  deployment tooling the same way `node_service_artifact` targets are.
- Template taxonomy parity tests (existing suite in
  `build-tools/tools/tests/scaffolding/`) must pass without modification after
  the new template is registered; if they do require modification, this task
  owns those changes.

## Why Now

Task #12 (backend service deployment template) depends on a service artifact
target existing before it can generate a deployment package that references
`component = "//projects/apps/<name>:service_artifact"`. Without a `go/service`
scaffold the developer writing #12 must hand-author both the application
directory and the deployment package simultaneously, conflating two distinct
concerns and making #12 harder to scope and review.

Task #23 (Bob setup) requires a concrete service in the repo to demonstrate an
end-to-end deploy flow. A scaffold-produced service is the correct starting
point: it is generic, reviewed, and cannot drift from the repo's build
conventions the way a hand-authored example can.

The `ts/service` template already exists and models exactly the pattern
needed here — health endpoint, runtime contract JSON, deployable TARGETS label,
unit test. Mirroring that shape for Go closes the gap that forces Go service
authors to start from `go/cli` and add service plumbing by hand.

## Risks

- **No `go_service_artifact` macro exists yet.** Unlike `node_service_artifact`
  in `build-tools/node/defs_service.bzl`, there is no equivalent Go-side macro
  that produces a finalized artifact directory and stable identity. The first
  iteration of this template will use `nix_go_binary` with a
  `deployment-component:service` label and a co-located `service.runtime.json`,
  which is sufficient for artifact admission once #12 adds the deployment
  package. A proper `nix_go_service_artifact` macro (analogous to
  `node_service_artifact`) is deferred and can be added as a follow-on or as
  part of #12 if deployment extraction requires it.

- **Template taxonomy parity contracts are strict.** The existing suite in
  `build-tools/tools/tests/scaffolding/` enforces that generated taxonomy
  outputs stay in sync with the canonical template root directories. Adding a
  new template that is not regenerated before running `v` will fail the
  `--check` gate in `gen-template-manifest-artifacts.ts`. The implementation
  must regenerate generated surfaces as part of this task, not defer it.

- **gomod2nix drift on first build.** The `go/service` scaffold produces a
  `go.mod` with no external dependencies; the `gomod2nix.toml` at the repo
  root must still be regenerated after scaffold creation (`node
  build-tools/tools/dev/install-deps.ts --glue-only`). If the scaffold test
  skips this step the Nix build will fail on a stale lockfile. The smoke test
  must include the install-deps step.

- **`service.runtime.json` schema version not yet shared.** The schema string
  `node-service-runtime@1` is Node-specific. The Go runtime contract needs
  either a `go-service-runtime@1` schema or a language-agnostic version. This
  task must pick one and document it; if deployment tooling in #12 needs to
  parse it, the schema version choice here becomes a coupling point.

## Trade-offs

- **`nix_go_binary` + label vs. a new `nix_go_service_artifact` macro.** A
  dedicated macro would enforce `service.runtime.json` presence at Buck load
  time and produce a finalized artifact directory the way `node_service_artifact`
  does. The trade-off is additional Starlark surface to define and test before
  #12 can unblock. Starting with a labeled `nix_go_binary` and a co-located
  `service.runtime.json` keeps this task self-contained and lets #12 decide
  whether a macro is required for deployment extraction. The downside is that
  nothing enforces the runtime contract at build time; a developer could delete
  `service.runtime.json` and the build would still pass.

- **Single template vs. separate `go/service-http` and `go/service-grpc`.** The
  `ts/service` template is a generic Node HTTP service; following that pattern
  with a single `go/service` template is the simplest path. gRPC or other
  service shapes can be added later under separate template IDs without
  breaking the existing taxonomy. This task does not add a gRPC variant.

- **Auto-wired tests vs. explicit test target.** The `go/lib` template relies on
  the `maybe_autowire_go_library_test` macro in `defs.bzl` to bind test files
  under `pkg/**/*_test.go` without a separate TARGETS entry. The `go/cli`
  template uses `nix_go_binary` which triggers `maybe_autowire_go_binary_test`.
  Following the same convention for `go/service` means the test TARGETS entry
  is implicit and the test file just needs to land under the canonical
  `cmd/<name>/` directory. This is consistent with the rest of the Go scaffold
  surface and avoids a hand-maintained test target.

## Considerations

- The `go/service` resolver destination is `projects/apps/{name}`, matching
  `go/cli`, because a service is still an application binary. It must be added
  to `resolver.json` under the `"go"` key alongside `"cli"` and `"lib"`.

- The `service` template key must be added to the `"go"` array in
  `template-taxonomy.generated.ts` via `gen-template-manifest-artifacts.ts`,
  not hand-edited. The parity contract test
  (`template-taxonomy.parity-contract.test.ts`) will catch any mismatch between
  the filesystem root and the generated taxonomy.

- The scaffold's `copier.yaml` must satisfy `scaf validate all`. The validate
  script checks `meta.json` for required fields (`language`, `template`,
  `description`, `help.usage`). The Go-specific constraints from
  `go-templates-phase-1-design.md` apply: `name` must be kebab-case
  (`^[a-z0-9][a-z0-9-]*$`), `go_min` must be `^1\.[0-9]+$`.

- The generated `service.runtime.json` health port defaults to `8080` for Go
  services (a common Go convention) rather than `3000` used by the
  `ts/service` template, unless a single canonical port default is established
  repo-wide. The `PORT` environment variable overrides the port at runtime in
  both cases; the JSON value is the documented fallback.

- The smoke test must run in a temporary rsync copy of the repo (excluding
  `buck-out`, `node_modules`, `.git`) and rely on the direnv-loaded dev shell
  for `buck2`, `nix`, and `go` on PATH — consistent with the test execution
  model mandated in `go-templates-dev-plan.md` and the existing
  `go-lib.scaffold-and-build.test.ts`.

- Buck label `deployment-component:service` on the binary target makes the
  generated app visible to deployment component extraction in the same way
  `node_service_artifact` targets are. The label must appear in the generated
  `TARGETS.jinja` so it survives `scaf regen` without manual re-addition.

- This task is language-scoped to Go. If a Rust or Python service scaffold is
  needed later, it follows the same pattern under `rust/service` or
  `python/service` respectively. Do not add a cross-language service template
  here.
