# ADR-00001: Monorepo Structure

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** viberoots team

## Context

viberoots spans multiple languages (Go, C++, Python, Rust, Node/TypeScript) and multiple deployment targets. Without a unified repository, cross-cutting concerns — shared libraries, toolchain wiring, deployment configuration, and build reproducibility — must be coordinated across separate repos with no single source of truth for dependency relationships or build correctness.

A monorepo collapses that coordination overhead into one graph. The tradeoff is build-system complexity: a naively structured monorepo degrades into an undifferentiated mass of files that is hard to reason about, slow to build, and brittle to change. The structure must therefore be enforced by tooling, not convention alone.

## Decision

The repository is organized as a single monorepo with the following top-level layout:

| Directory               | Responsibility                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `build-tools/`          | Build system root: Starlark helpers, per-language support, TypeScript/zx tooling, deployment tooling, and test harnesses |
| `projects/apps/`        | Application roots (web apps, services, CLIs, and other runnable products)                                                |
| `projects/libs/`        | Shared library roots                                                                                                     |
| `projects/deployments/` | Deployment package roots; one directory per deployment-id, each exposing a `:deploy` Buck target                         |
| `projects/config/`      | Repository-specific deployment topology: checked-in `shared.json` plus gitignored `local.json`                           |
| `docs/`                 | Design and operational documentation                                                                                     |
| `patches/`              | Repo-level patch overlays                                                                                                |
| `third_party/`          | External provider metadata (no Go source vendoring)                                                                      |
| `toolchains/`           | Buck toolchain wiring                                                                                                    |
| `flake.nix`             | Nix devshell and hermetic build outputs                                                                                  |
| `TARGETS`               | Authoritative deployment and project metadata (Buck2)                                                                    |
| `METHODOLOGY.XML`       | Project methodology and architectural principles                                                                         |

Two complementary build systems are used together and are both required:

- **Buck2** answers "what needs building or testing right now?" It owns the dependency graph, target labeling, and incremental builds across the whole repo.
- **Nix** answers "can the recipe produce the artifact hermetically?" It owns artifact assembly, devshell provisioning, and cache warming.

Locally, Buck2 alone is sufficient. In CI, stages are split — Export Graph, Sync Providers, Auto Map, Prebuild Guard, Nix Build, Buck Build/Test — to maximize cache reuse and produce clear per-stage diagnostics.

Go modules are not vendored into the tree. `third_party/go` holds metadata only; `gomod2nix.toml` is the authoritative lock file.

Buck2 macros stamp `lang:<go|cpp|python|rust|node>` and `kind:<bin|lib|test>` labels on every target. These labels are the sole mechanism by which the graph exporter identifies targets deterministically; no external naming convention is required.

## Consequences

### Positive

- A single dependency graph covers all languages and all deployments, making cross-cutting changes atomic and auditable in one commit.
- Hermetic Nix builds eliminate "works on my machine" failures; the same artifact is produced locally and in CI.
- Buck2 incremental builds mean contributors pay only for what they change, not a full repo rebuild.
- Stamped target labels make graph export deterministic and independent of file paths or naming conventions.
- Centralizing toolchain wiring in `toolchains/` and build support in `build-tools/` keeps application code in `projects/` free of build-system boilerplate.

### Trade-offs

- Both Buck2 and Nix must be understood to contribute effectively; the learning curve is steeper than a single-language, single-tool setup.
- The six-stage CI pipeline is more complex to operate and debug than a flat script, even though each stage has a single responsibility.
- Go source is not vendored, so network access or a warm Nix cache is required to build Go targets from a cold state.
- The 250-line file limit and strict module boundaries require ongoing discipline; violations must be caught in review, not automatically enforced by the build system.

### Obligations

- Every new language added to the repo must have a corresponding support subtree under `build-tools/` and toolchain entry under `toolchains/` before any project-level code is introduced.
- Every new deployment target must live under `projects/deployments/` and expose a `:deploy` Buck target; ad-hoc deployment scripts outside this structure are not permitted.
- Shared deployment topology belongs under `projects/config/shared.json`; per-operator values and local overrides belong under `projects/config/local.json`.
- Go dependency changes must be reflected in `gomod2nix.toml` and must not introduce source files into `third_party/go`.
- All Buck targets must carry the canonical `lang:` and `kind:` stamps to remain visible to the graph exporter.
