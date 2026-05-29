# Remote Builds and Distributed Tests

This document describes the current remote-build state of this repository and the design needed to make remote builds and distributed test execution reliable on spot capacity.

The short version:

- Nix remote builders and binary caches are usable today for many `nix build` calls, but the repo has a few intentional paths that disable builders.
- Buck2 remote execution is not enabled today. The repo has a placeholder `toolchains//:remote_test_execution` target, but no Buck2 RE client config or remote execution profiles.
- The target architecture is Buck2-native remote execution for build and test actions, backed by Nix-native binary caches and remote builders. Custom code should handle orchestration around Buck/Nix, not reimplement their execution engines.
- Spot workers should be stateless, preemptible RE workers backed by CAS, immutable logs/artifacts, a Nix binary cache, and narrowly scoped credentials.

## Current State

### What Works Today

The active build system is Buck2 as the orchestrator and Nix as the hermetic toolchain/build layer. The flake exports conventional package attributes for the supported systems (`aarch64-darwin`, `aarch64-linux`, `x86_64-linux`), including:

- `.#graph-generator`
- `.#graph-generator-selected`
- `.#graph-generator-cppTargets`
- `.#graph-generator-selected-wasm`
- `.#graph-generator-pure`
- `.#graph-generator-pure-selected`
- `.#buck-graph` when `BUCK_GRAPH_JSON` is supplied with impure evaluation
- `.#test-seed`
- `.#node-test.<importer>`
- `.#py-wheelhouse-*`
- language and deployment package outputs
- `.#remote-worker-tools`
- `.#remote-ci-tools`

Language-specific Buck rules generally call Nix through the selected-target path. The common shape is:

1. Buck exports or consumes the target graph.
2. A rule or test runner sets `BUCK_TARGET`, `BUCK_GRAPH_JSON`, `WORKSPACE_ROOT`, and related env.
3. `build-tools/tools/dev/build-selected.ts` invokes `nix build --impure ... .#graph-generator-selected` or a target-specific selected output.

The implementation-required Nix feature floor is only:

```conf
experimental-features = nix-command flakes
```

`dynamic-derivations`, `recursive-nix`, and `ca-derivations` are not implementation requirements in the current codebase. They can be evaluated as organization policy, but this repo should not require them for normal startup checks. `build-tools/docs/build-system-design.md` still uses dynamic-derivation architecture terminology, but its current Nix feature snippet and the current startup check require only `nix-command` and `flakes`.

### Nix Build Shape

The current implementation uses conventional flake outputs, graph-generator package attributes, selected-target env, and pure graph outputs such as `.#graph-generator-pure-selected`.

`.#buck-graph` is a graph-materialization output, not a standalone pure `nix build .#buck-graph`. It requires an exported graph path through `BUCK_GRAPH_JSON` and impure evaluation.

`build-tools/tools/dev/build-selected.ts` uses `--no-link --print-out-paths` for selected-target `nix build` calls and consumes the printed store path directly. Local verify seed preparation still uses `--out-link` under `buck-out/tmp/verify-seed` to pin `.#test-seed`; remote-ready seed mode uses `--no-link --print-out-paths` and must publish explicit artifact/cache manifest evidence before it can be selected.

Remote builders are not automatically used for every `nix build` invocation in this repository:

- `.envrc` injects `NIX_CONFIG` with empty `builders =`, empty `build-hook =`, and `max-jobs = auto` unless `NIX_CONFIG` already contains `builders =`.
- Known local-only Nix paths include `build-tools/tools/dev/node-modules-build.ts`, `build-tools/tools/buck/node-cli-bundle.ts`, update-pnpm-hash/store-refresh helpers, and some tests/scaffolding helpers that pass `--builders ""`.
- Most selected-target Nix builds can use configured builders if the environment allows them, but repo-local wrappers may intentionally prefer local builds for latency, reproducibility, or store-cache behavior.

Nix-invoking repo tools classify builder behavior explicitly:

- `local_only`: pass `--builders ""` for bootstrap, temp-workspace, and local checkout flows that
  must not escape to configured builders.
- `inherit_config`: do not pass `--builders`; CI or the Nix daemon decides the effective builders.
- `force_builders_file`: pass only a generated builders file selected by CI/smoke tooling.

Remote-ready selected builds must not use `local_only`. Paths labeled `remote:ready` that inherit
builders or force a generated builders file need remote-builder smoke evidence for the same selected
policy, such as `inherit_config` smoke for an `inherit_config` action. Because `.envrc` may mask
builders for local development, remote-builder smoke and CI lanes must export their intended
`NIX_CONFIG` before entering the repo.

The flake exports `packages.<system>.remote-worker-tools` and
`packages.<system>.remote-ci-tools` for declared remote worker and CI helper closures.
It also exports `apps.<system>.remote-worker-bootstrap` as a local check helper. The bootstrap app
prints the worker closure path, restricts `PATH` to that closure, checks required binaries, and
does not register with a scheduler.

### Worker and CI Tool Closures

`remote-worker-tools` contains only conservative worker-side runtime tools required by current
remote-ready Buck/Nix actions: Bash, coreutils including `timeout`, findutils, GNU grep/sed/awk,
Git, Node 22, PNPM, Buck2, and `zx-wrapper`.

`remote-ci-tools` composes the worker closure with the Nix CLI for CI-side cache publishing and
remote-builder smoke flows. Backend-specific RE daemons, sidecars, cache publisher clients,
artifact upload clients, metrics shippers, and worker registration tools must be added as separate
Nix packages before any repo helper may invoke them.

Allowed non-Nix machine prerequisites are limited to kernel/sandbox support, disk capacity,
network reachability, mounted credentials or workload identity material, trust anchors, clock
sync, and minimal Nix bootstrap. SSH, provider CLIs, artifact upload tools, metrics/logging CLIs,
cache publishers, and worker registration binaries are executable dependencies, not primitives.
Worker images must not bake repo tools, language runtimes, Buck binaries, helper CLIs, RE runtime
binaries, registration tools, artifact/cache/metrics clients, or credentials outside these declared
closures.

### CI Today

Jenkins runs a matrix over:

- `aarch64-darwin`
- `aarch64-linux`
- `x86_64-linux`

Each axis currently runs `node build-tools/tools/ci/run-stage.ts --stage <name>` through `codegen`, `export-graph`, `sync-providers`, `gen-auto-map`, `prebuild-guard`, `nix-gaps-policy`, `cpp-addon-smoke`, `file-size-lint`, `patches-lint`, `nix-build-graph-generator`, `wheelhouse-preload`, `buck-test`, and a coverage pass that reruns `buck-test` with `COVERAGE=1` before `pnpm coverage:build`.

The `wheelhouse-preload` stage already has one implemented cache-push path:

```bash
NIX_CACHE_TO='s3://...' node build-tools/tools/ci/run-stage.ts --stage wheelhouse-preload
# or
node build-tools/tools/ci/run-stage.ts --stage wheelhouse-preload --to 's3://...'
```

It discovers `py-wheelhouse-*` attrs, builds them, and runs `nix copy --to` when a destination is configured. Jenkins currently invokes the stage but does not configure the cache destination in the `Jenkinsfile`.

### Verify Today

`v` is not just `buck2 test //...`.

It performs startup checks, lint/policy preflights, template manifest checks, verify locking, Nix GC and disk preflights, optional coverage setup, optional unified/toolchain prewarm, conditional test-seed preparation, target expansion, test pass scheduling, Buck daemon cleanup/watchdog work, and merged coverage reporting.

Concrete tests are discovered through Buck cquery. Recursive selectors expand with `kind(test, ...)`; explicit targets are queried directly and are expected to already be Buck test targets. Tests are then split by labels:

- `verify:isolated`: isolated pass, single-threaded by default
- `verify:resource-limited`: resource-limited pass, currently 4 threads
- everything else: shared pass

Current verify planning partitions tests into isolated, resource-limited, and shared passes. `verify:isolated` and `verify:resource-limited` are serial barriers in the default pass plan; shared/non-serial pass groups can run concurrently only when grouped by the planner. Any distributed design must preserve those policy semantics.

### Buck2 Remote Execution Today

Buck2 remote execution is not configured.

The repo currently has:

- `toolchains//:remote_test_execution`
- a thin `toolchains/remote_test_execution.bzl` re-export of Prelude's remote test execution toolchain
- named dormant remote test profiles in `toolchains/remote_execution_profiles.bzl`
- an inactive execution platform registration target at `toolchains//:remote_execution_platforms`
- no `[buck2_re_client]` section in `.buckconfig`
- no REAPI/CAS/scheduler/worker service in this repo

That means Buck2 RE is a required design target, but not yet an operational path in the current repository.

### Dormant Buck Profile Vocabulary

Remote test profiles live in `toolchains/remote_execution_profiles.bzl` and are attached to
`toolchains//:remote_test_execution`, but the committed toolchain keeps `default_profile = None` and
`default_run_as_bundle = False`. The reviewed profile names are `linux-x86_64-default`,
`linux-x86_64-large`, `linux-aarch64-default`, `linux-aarch64-large`, and
`darwin-aarch64-default`.

Every profile uses only Prelude-supported keys: `capabilities`, `listing_capabilities`,
`local_listing_enabled`, `local_enabled`, `use_case`, `remote_cache_enabled`, `dependencies`,
`resource_units`, and `remote_execution_dynamic_image`. `capabilities` and `use_case` are required
because Prelude converts named profiles through `get_re_executors_from_props(ctx)`.

Build execution platforms live separately in `toolchains/remote_execution_platforms.bzl`. The
registration target returns `ExecutionPlatformRegistrationInfo` and carries
`ExecutionPlatformInfo.executor_config` values with explicit local, remote, and limited-hybrid
settings. Build platforms use `remote_execution_use_case = "buck2-build"` and the same capability
vocabulary as the test profiles through `remote_execution_properties`.

These surfaces are inert until a generated Buck config explicitly selects
`build.execution_platforms = toolchains//:remote_execution_platforms` or a test target/toolchain
explicitly selects a named remote profile. Local verify, Jenkins defaults, and direct local
`buck2 test //...` invocations must not select them by default.

## Remote Nix Builders

Remote Nix builders are the Nix-layer acceleration path and should remain part of the target architecture.

They are useful when a local or CI process invokes Nix for expensive artifacts and the environment does not disable builders. They do not distribute Buck's own analysis, cquery, scheduling, or test execution; they only distribute Nix builds.

### Client Config

Example `/etc/nix/nix.conf`:

```conf
experimental-features = nix-command flakes
builders-use-substitutes = true
builders = @/etc/nix/machines
max-jobs = 0
```

Example `/etc/nix/machines`:

```text
ssh-ng://nix-builder@builder-x86-linux.example.com x86_64-linux /etc/nix/builder_ed25519 16 1 big-parallel
ssh-ng://nix-builder@builder-arm-linux.example.com aarch64-linux /etc/nix/builder_ed25519 16 1 big-parallel
ssh-ng://nix-builder@builder-arm-darwin.example.com aarch64-darwin /etc/nix/builder_ed25519 8 1 big-parallel
# With host-key pinning, field 8 is the base64 public host key; keep "-" in field 7 when there are no mandatory features.
ssh-ng://nix-builder@builder-x86-linux.example.com x86_64-linux /etc/nix/builder_ed25519 16 1 big-parallel - <base64-public-host-key>
```

Use `ssh-ng://` when the installed Nix version supports the experimental SSH store and the remote `nix-daemon` program is available to the SSH user; configure the store `remote-store` setting explicitly if the remote should use a daemon or a direct local store. Otherwise use `ssh://`, which uses `nix-store` on the remote host and requires `nix`/`nix-store` in the remote SSH user's non-interactive path. In both cases, the remote SSH user must be trusted by the remote Nix configuration for distributed builds. The third machines-file field is the SSH key path, or `-` for the default key. The effective Nix daemon identity on the client/CI host must be able to use that key non-interactively, and host keys must be pinned through the daemon identity's `known_hosts` or the machines-file host-key field. The machines-file host-key field is a base64-encoded public host key, not an OpenSSH `known_hosts` line.

Connectivity smoke test:

```bash
nix store info --store 'ssh-ng://nix-builder@builder-x86-linux.example.com?ssh-key=/etc/nix/builder_ed25519'
```

Build smoke test:

```bash
export NIX_CONFIG=$'experimental-features = nix-command flakes\nbuilders = @/etc/nix/machines\nmax-jobs = 0\nbuilders-use-substitutes = true\n'
nix build .#graph-generator --no-link --accept-flake-config --rebuild
```

In this repo, `/etc/nix/nix.conf` builders are masked by `.envrc` unless `NIX_CONFIG` already contains a `builders = ...` setting before `direnv` loads. CI and dev shells that want remote builders should export `NIX_CONFIG` with `builders = @/etc/nix/machines` before entering the repo, or opt out of `direnv` for the remote-builder smoke test.

### Builder Host Requirements

Each builder host needs:

- Nix installed, SSH server reachable, and the selected remote store program available in the remote SSH user's non-interactive path (`nix-daemon` for `ssh-ng://`, `nix-store` for `ssh://`)
- `experimental-features = nix-command flakes`
- SSH access from the effective Nix daemon identity on the client/CI host, not only from an interactive shell user
- the remote SSH user listed in the builder URI must be in the builder host's `trusted-users`
- enough disk for `/nix/store`; plan for aggressive GC rather than tiny disks
- trusted substituters and public keys matching the organization cache
- no developer override env (`NIX_GO_DEV_OVERRIDE_JSON`, `NIX_CPP_DEV_OVERRIDE_JSON`, `NIX_PY_DEV_OVERRIDE_JSON`)

For Linux builders on spot instances, use immutable images or bootstrapping that converges quickly:

1. Install Nix.
2. Configure substituters and trusted keys.
3. Join SSH trust for the CI/client identity.
4. Warm high-value paths (`.#toolchains.go`, `.#toolchains.cxx`, `.#toolchains.python`, `.#buck2-prelude`, `.#node-modules.default`, `.#node-modules.<sanitized-importer>`, `.#py-wheelhouse-<sanitized-importer>`) from the binary cache.
5. Register the instance in the generated `/etc/nix/machines` consumed by CI or a bastion.

### Binary Cache

A binary cache is required for spot economics. Without it, every preempted worker loses too much work.

The design is not tied to Cachix. The architecture requires an organization-controlled Nix substituter with signed metadata, reader trust configuration, publisher-only signing/write authority, retention policy, regional placement, and hit-rate/cost observability.

Supported implementations include:

- self-hosted HTTP or S3-compatible Nix binary caches
- Attic, Harmonia, or another Nix substituter service
- managed Cachix

The most straightforward cloud path is managed Cachix when the priority is speed of adoption and low operational burden. Cachix provides the hosted substituter endpoint, server-side signing by default, read/write access tokens, CDN-backed reads, retention controls, and a purpose-built `cachix push` publisher flow.

The most straightforward self-hosted cloud path is Attic backed by a managed Postgres database and S3-compatible object storage. This preserves provider neutrality while still using a Nix-native cache service with managed signing, multi-tenant cache names, deduplication, garbage collection, and `attic push`/`attic use` client flows. Run `atticd` as a small replicated service behind HTTPS, place object storage near the dominant worker regions, and keep the database and signing material under infrastructure control.

If the managed-dependency baseline is Supabase, the straightforward Attic topology is:

1. Use Supabase Postgres as Attic's metadata database. `atticd` is a persistent backend service, so prefer the direct Postgres connection when the host has IPv6 support; use Supabase's session pooler when the host needs IPv4 compatibility. Avoid transaction-pooler mode unless Attic is explicitly verified against it, because transaction poolers can break clients that rely on session state or prepared statements.
2. Use Supabase Storage's S3-compatible endpoint as Attic's object store after a live conformance test. Configure Attic with the direct storage hostname form, for example `https://<project-ref>.storage.supabase.co/storage/v1/s3`, the Supabase project region, path-style access, a dedicated private bucket, and server-side S3 access keys stored in the secret manager.
3. Run `atticd` outside hosted Supabase as a long-running service on the selected cloud container/VM platform. Hosted Supabase compute is for Supabase-managed product services, including Postgres and Edge Functions; it is not arbitrary always-on container hosting for services such as `atticd`. Edge Functions are request-scoped runtimes and are not the right place for an always-on Nix substituter that serves large downloads.
4. Put HTTPS, auth policy, and rate limiting in front of `atticd`. Public read access is acceptable only for non-sensitive outputs; private caches require reader credentials. CI receives a push-scoped Attic token. Developers and workers receive pull-only configuration.
5. Use Supabase Auth and WorkOS for the human and organization control plane, not as direct substitutes for Attic cache credentials. The operator UI/API should authenticate users with the selected Supabase Auth/WorkOS flow, authorize cache actions through the existing organization/role model, audit the decision, then mint or retrieve narrowly scoped Attic tokens for the requested subject. Attic remains the cache authorization authority for Nix traffic because Attic uses signed JWTs with cache permissions, `attic login`/`attic use` configure Nix credentials, and Nix substituter clients expect cache credentials rather than browser SSO sessions.
6. Keep Supabase Auth, WorkOS, and PostgREST out of the hot cache data path. They may protect token issuance, cache administration, audit views, and emergency revocation workflows, but `nix build`, `attic push`, and worker substitution should talk to Attic with Attic-compatible tokens. Do not proxy Nix cache downloads through application auth middleware.
7. Record the production cache as a named managed dependency with endpoint, cache name, public signing key, retention policy, storage bucket, database connection mode, token scopes, owner, and rollback procedure.

Supabase is a better fit than RDS only when the cache service is part of the broader Supabase-centered control-plane architecture. Supabase provides managed Postgres plus adjacent platform services: Auth, Storage with S3-compatible access, PostgREST/Data API, dashboard/API-key management, local development workflows, and a single project boundary for operator-facing features. Those services can simplify cache administration, token issuance workflows, audit views, and shared artifact/control-plane dependencies.

For Attic metadata alone, RDS is the more direct AWS-native database choice. RDS gives mature AWS networking, IAM/KMS/Secrets Manager integration, private subnets, security groups, VPC endpoints, backup/restore controls, Multi-AZ options, and a simpler private path when `atticd` already runs on AWS. Choose RDS when the cache stack is intentionally AWS-native, when strict private networking is mandatory, or when Supabase Auth/Storage/API features are not being used by the surrounding control plane. Choose Supabase when the surrounding system already depends on Supabase Auth/WorkOS, Supabase Storage, and Supabase-managed operational workflows, and the cache can accept the Supabase networking and storage compatibility constraints validated in this document.

Private networking changes the provider choice. Supabase PrivateLink is the clean private-database option, but it is currently an AWS VPC Lattice/PrivateLink integration for direct Postgres and PgBouncer connections only; it does not cover Supabase Storage, Auth, Realtime, or API traffic. It also requires the Attic host to run in an AWS VPC in the same region as the Supabase project and the required Supabase plan/support path. If strict private database connectivity is required, the simplest topology is `atticd` on AWS ECS/Fargate, EC2, or a small NixOS VM in that VPC, Supabase Postgres over PrivateLink, and AWS S3 through a VPC endpoint for object storage. Supabase Storage S3 remains a reviewed alternate when public HTTPS object-store traffic is acceptable and Supabase platform integration is worth using a separate storage backend, because hosted Supabase Storage does not currently participate in the Supabase PrivateLink path.

Vercel is a good fit for dashboards, admission APIs, operator UI, webhooks, and short request/queue orchestration around the cache. It is not the right runtime for `atticd`: Vercel Functions remain invocation-bounded even with Fluid Compute, and Vercel does not provide arbitrary always-on container hosting for a long-lived Nix substituter. Do not proxy Nix cache traffic through Vercel Functions; that would add duration limits, body-size/bundling constraints, cost risk, and another custom cache path.

Cloudflare pairs well with Supabase for the edge-network parts of the design. In the AWS-hosted topology, AWS S3 is the default Attic object store because `atticd`, the control-plane artifact store, and build/test workers can share the same AWS network and IAM/VPC endpoint model. Supabase Storage S3 remains a reviewed alternate when public HTTPS object-store traffic and Supabase platform integration are preferred. Cloudflare R2 is S3-compatible, avoids object-store egress fees, and is the strongest alternate Attic object store if AWS S3 or Supabase Storage S3 conformance, throughput, regional behavior, object-count behavior, or cost is not acceptable. Cloudflare DNS, TLS, WAF, rate limiting, and CDN can also sit in front of `atticd` when cache auth and cache-control behavior are explicitly verified.

Cloudflare Workers are not a host for `atticd`: they are invocation-scoped and have CPU, memory, request-size, subrequest, and startup limits. Cloudflare Containers are closer because they run arbitrary Linux containers on the Workers platform, but the current model is Worker-controlled, can start on demand, can sleep after inactivity, has ephemeral disk across sleep, requires `linux/amd64` images, and is still a platform-specific lifecycle. Treat Cloudflare Containers as a candidate only after a live validation proves stable always-warm operation, rolling deploy behavior, large NAR download behavior, Attic token/auth behavior, observability, cost, and failure recovery. The lower-risk production default remains a conventional always-on container/VM service for `atticd`, paired with Supabase Postgres and AWS S3 in the AWS-hosted topology; Supabase Storage S3 and Cloudflare R2 remain reviewed alternate object stores.

AWS does not provide a managed Attic service or managed Nix substituter. AWS CodeArtifact is a managed package repository for supported package formats such as npm, PyPI, Maven, NuGet, RubyGems, Swift, Cargo, and generic packages, but it is not a Nix binary cache service and should not be treated as an Attic replacement. The AWS-native Attic shape is self-managed `atticd` on ECS/Fargate, EC2, or a small NixOS VM, with optional RDS Postgres, S3 object storage, ALB/CloudFront, IAM/KMS/Secrets Manager, and VPC endpoints where the design chooses AWS-managed dependencies instead of Supabase-managed dependencies.

Recommended service mapping:

- Control plane: Supabase Postgres for durable control-plane state, Supabase Auth plus WorkOS for operator identity and organization authorization, AWS S3 for control-plane artifacts in the AWS-hosted topology after the artifact-store conformance suite passes, and a small always-on web/API runtime for operator UI and admission APIs. Supabase Storage S3 remains a reviewed alternate when public HTTPS object-store traffic and Supabase platform integration are preferred. Vercel is acceptable for the operator UI/API if the endpoints stay request-scoped and do not proxy cache or build/test traffic. If the control-plane backend needs long-running workers, host those workers on EC2/ECS-on-EC2 or another always-on container/VM service.
- Attic service: run `atticd` on a small On-Demand EC2 instance or tiny EC2 Auto Scaling Group in the AWS VPC. Use Supabase Postgres over PrivateLink for metadata if the broader architecture stays Supabase-centered. Use AWS S3 through a VPC endpoint for Attic object storage when private object-store traffic matters. Put ALB/NLB and TLS in front of `atticd`, with Cloudflare DNS/WAF/rate limiting optionally in front after cache auth and cache-control behavior are verified. Do not run `atticd` on Spot.
- Build/test workers: use EC2 Spot fleets for Linux Nix remote builders and Buck2 RE workers. Keep Nix remote builders and Buck2 RE workers as distinct roles even when they share an image family. Use Graviton Spot for `aarch64-linux`, x86 Spot for x86-only or parity lanes, scale-to-zero for low-priority queues, small warm pools for interactive CI, and bounded On-Demand fallback for deadline-bound runs. macOS remains a dedicated macOS worker lane or local-execution lane with the same reporting contract.
- Container scheduling: start with direct EC2 Auto Scaling groups or EC2 Fleet for one-worker-per-host simplicity. Move to ECS-on-EC2 capacity providers when multiple containerized daemons or task shapes need shared placement, rolling deploys, service discovery, and separate On-Demand/Spot capacity providers while retaining EC2 host control. Keep Fargate for simple service containers only when host-level Nix/sandbox control is not required.
- Edge/network services: use Cloudflare for DNS, TLS/WAF/rate limiting, and possibly CDN in front of read paths after validating Nix/Attic cache semantics. Do not use Cloudflare Workers, Vercel Functions, or Supabase Edge Functions as the hot cache or build/test execution layer.

Direct S3-compatible Nix binary caches are valid and simple for `nix copy --to s3://...`, but they push more signing, retention, indexing, and credential-boundary responsibility into CI and infrastructure. Use direct S3 only when the desired cache contract is intentionally a plain Nix store rather than a managed cache service.

The home Attic endpoint `https://cache.home.kilty.io/` is useful evidence that the workflow already exists, but it is not the production cache target. Cloud workers and CI should use a production cloud endpoint such as `https://cache.<domain>/<cache-name>` with documented cache name, trusted public key, read credentials, publisher token, retention policy, and owner.

Developer machines should trust the cache without replacing the default substituter set:

```conf
# /etc/nix/nix.conf on daemon-managed machines
# Use priority when the organization cache should be preferred over cache.nixos.org.
extra-substituters = https://cache.<domain>/<cache-name>?priority=30
extra-trusted-public-keys = vbr-cache-1:<pubkey>

# Admin/CI daemon allow-list for opt-in user configs:
trusted-substituters = https://cache.<domain>/<cache-name>?priority=30
```

Use `extra-substituters` plus `extra-trusted-public-keys` in daemon config when the cache should be enabled by default. Use `trusted-substituters` plus the trusted public key as an admin allow-list for opt-in user configs. Untrusted users can opt into allow-listed caches with `extra-substituters`; they cannot make a new substituter trusted solely from `NIX_CONFIG`.

For Cachix-backed caches, the developer setup remains:

```bash
nix profile install --accept-flake-config nixpkgs#cachix
cachix use <cache>
```

For private Cachix caches, configure a read-scoped token before `cachix use`, for example with `cachix authtoken <read-token>` or `CACHIX_AUTH_TOKEN`.

CI should push narrowly scoped closures after successful builds, not the whole local store. Publishers get backend-specific write authority only.

Generic writable Nix stores such as `s3://...`, `file://...`, and `ssh://...` can be populated with `nix copy` and, where needed, signing material:

```bash
out=$(nix build .#graph-generator --no-link --accept-flake-config --print-out-paths)
nix copy --extra-secret-key-files /run/secrets/nix-cache-key \
  --to "s3://bucket?region=us-east-2" "$out"
# For Cachix:
cachix push <cache> "$out"
```

Managed Cachix should use `cachix push`; Attic should use `attic push`. Harmonia and nix-serve serve an existing Nix store, so populate them by building on the cache host or copying closures to the host/store, then signing with host-owned cache keys. For generic writable Nix stores such as S3 or local file binary caches, CI publishers may need signing material through `secret-key-files`, `--extra-secret-key-files`, or the destination store's `secret-key`/`secret-keys` setting. Cache services and store-serving hosts should keep signing material with the cache service or host unless explicitly configured for local self-signing; CI should receive only the backend-specific write capability required for that model, not broad signing keys. For managed Cachix, publishers need Cachix write auth such as `CACHIX_AUTH_TOKEN`; Cachix signs server-side by default. Only self-signed Cachix caches need publisher-side signing material such as `CACHIX_SIGNING_KEY`. Readers should receive only trusted public keys and read credentials, never signing keys.

Wheelhouse preload currently supports `nix copy`-compatible destinations through `NIX_CACHE_TO` or `--to`, such as S3, file, or SSH store URIs:

```bash
NIX_CONFIG=$'secret-key-files = /run/secrets/nix-cache-key\n' \
NIX_CACHE_TO="s3://bucket?region=us-east-2" \
  node build-tools/tools/ci/run-stage.ts --stage wheelhouse-preload
```

For S3 binary caches, the signing key can also be supplied as a store setting in the destination URI if the installed Nix version supports it. Managed Cachix publishing remains design-compatible, but it needs a separate `cachix push` CI step or a dedicated publisher hook.

Publish two cache sets deliberately:

- runtime closures for downstream consumers of built outputs
- builder/worker prewarm closures for remote execution, including the archived flake source and locked inputs, selected toolchain attrs, `.#buck2-prelude`, `.#test-seed`, wheelhouse outputs, and worker tool closures

Attic is appropriate as the hot and warm Nix binary cache for retained build outputs when its retention and garbage-collection policy is configured deliberately. Each production cache must declare a retention period, GC schedule, storage quota policy, and ownership model. Do not rely on default unbounded cache growth or ad hoc manual deletion. Retention policy must be source-revision aware: release, regulatory, incident-response, and reproducibility closures belong in a separate cache namespace or protection class from disposable CI acceleration outputs.

For regulatory or audit retention, treat Attic as the Nix substituter and deduplicated serving layer, not as the sole system of record. Publish an immutable build provenance bundle alongside the cache entry: source revision, flake lock, graph digest, exact store paths, `.narinfo` metadata, signing key identity, builder platform identity, RE/Buck event-log identity, test summary, SBOM/attestation when available, and the archive retention class. Store that bundle and any legally required artifacts in an append-only or object-lock-capable artifact archive with lifecycle policy, access logging, and deletion controls. The archive may point back to Attic paths for fast substitution, but an Attic GC policy must never be the only thing preserving regulated artifacts.

Developers can hydrate published wheelhouse closures for offline or low-network local work. CI should archive the exact flake source and all locked inputs with Nix itself, then publish exact output closures.

For writable Nix store backends:

```bash
nix flake archive --to "$WRITABLE_STORE" .
nix flake archive --json . > flake-archive.json
nix build .#py-wheelhouse-<sanitized-importer> \
  --no-link --accept-flake-config --print-out-paths > outputs.txt
nix copy --to "$WRITABLE_STORE" --stdin < outputs.txt
```

For Cachix or Attic, archive/build locally, extract exact store paths, and pass those paths to the backend CLI:

```bash
nix flake archive --json . \
  | jq -r '.path,(.inputs|to_entries[].value.path)' > flake-input-paths.txt
nix build .#py-wheelhouse-<sanitized-importer> \
  --no-link --accept-flake-config --print-out-paths > outputs.txt
cachix push <cache> $(cat flake-input-paths.txt outputs.txt)
# or:
attic push <cache> $(cat flake-input-paths.txt outputs.txt)
```

Any helper used to parse archive JSON, such as `jq`, must come from the repo's Nix-provided tool closure or devshell, not from mutable image packages.

Hydration verification remains against a read substituter:

```bash
nix copy --from "https://<cache-endpoint>" --stdin < outputs.txt
nix build .#py-wheelhouse-<sanitized-importer> --offline --accept-flake-config --no-link
```

Offline mode is only a verification step after hydrating archived flake inputs and exact output paths. Do not rely on a hand-maintained flake-input path list or on re-resolving a flake attr as the hydration step. If evaluation inputs are not already in the local store, `--offline` can still fail before substitution because it disables substituters.

### Developer Quickstart

For a local smoke test of the current Nix layer:

```bash
node build-tools/tools/dev/startup-check.ts
nix build .#graph-generator --no-link --accept-flake-config --rebuild
```

For a local smoke test that attempts to force an eligible derivation onto remote builders:

```bash
export NIX_CONFIG=$'experimental-features = nix-command flakes\nbuilders = @/etc/nix/machines\nmax-jobs = 0\nbuilders-use-substitutes = true\n'
nix store info --store 'ssh-ng://nix-builder@builder-x86-linux.example.com?ssh-key=/etc/nix/builder_ed25519'
nix build .#graph-generator --no-link --accept-flake-config --rebuild
```

This does not override derivations that prefer local builds, missing system/feature matches, or daemon SSH/trust failures.

## Distributed Test Execution Design

Remote Nix builders are not enough to make `v` or the Jenkins Buck test stages distributed. The ideal state is a Buck2-native remote execution system:

- Buck2 performs target analysis, action construction, action execution/cache interaction, and the test-runner protocol.
- Test execution and result reporting happen through Buck2's test runner using `ExternalRunnerTestInfo` and Buck-provided executor configs.
- Nix provides hermetic toolchains, selected-target builds, binary cache substitution, and optional SSH remote builders for Nix store builds that happen inside workers.
- The repo-owned control plane handles only the parts Buck and Nix do not own: spot fleet capacity, worker registration, credential scoping, policy gates, queue-depth driven autoscaling, and run-level observability.

This design avoids a custom test execution engine. A worker may have a clone for bootstrapping, diagnostics, and local smoke checks, but remote Buck actions should receive their inputs through REAPI/CAS and should not depend on an ambient checkout unless the action explicitly declares that checkout materialization as an input.

### Division Of Responsibility

Use built-in Buck2 capabilities for:

- target graph expansion (`cquery`, `kind(test, ...)`, labels)
- action construction
- local and remote cache keys
- REAPI/CAS upload/download
- action scheduling to remote workers
- test execution protocol
- test result status
- event logs and action timing

Use built-in Nix capabilities for:

- pinned toolchains
- selected-target package builds
- binary substitution
- closure copying
- SSH remote Nix builders
- store path verification
- Nix sandboxing on builder/worker hosts

Add custom repo code only for:

- translating `v` policy into Buck target sets and Buck options
- provisioning and draining spot workers
- registering worker capabilities by platform/provider/resource class
- distributing Buck2 RE client credentials to CI and workers
- configuring Nix substituters/builders on workers
- publishing run-level summaries, logs, coverage artifacts, and diagnostics
- enforcing credential boundaries for deployment-domain tests

### Buck2 REAPI Target Architecture

The Buck2 RE deployment should include:

- a REAPI scheduler endpoint compatible with the pinned Buck2 commit
- a CAS and action cache sized for the repo's source/actions
- Linux `x86_64` and `aarch64` worker pools
- a macOS worker pool or a dedicated macOS local-execution lane with identical reporting semantics
- worker images with host-level prerequisites, Nix, cache trust config, cloud identity plumbing, and required sandbox support; repo-controlled build/test tools must be supplied by `packages.<system>.remote-worker-tools`. Backend-specific RE worker runtimes and sidecars must be declared Nix packages and composed into the worker closure before repo helpers invoke them.
- a CI-only `.buckconfig` include or generated config containing `[buck2_re_client]`
- non-empty `toolchains//:remote_test_execution` profiles for the supported worker classes
- repo-owned test rules wired to expose remote execution selection, translate selected profiles through Prelude's RE helpers, and pass Buck's `default_executor` / `executor_overrides` into `ExternalRunnerTestInfo`; this is selection plumbing only and does not make a wrapper family remote-ready
- a remote-enabled execution platform/executor path for build actions, separate from the test-only remote execution toolchain
- explicit local fallback policy, configured per lane rather than hidden in developer defaults

The target behavior for a CI test run is:

1. CI runs the normal preflight and target-selection logic.
2. CI invokes Buck2 with RE enabled and target-platforms set.
3. Buck2 uploads action inputs to CAS.
4. The RE scheduler assigns actions to matching workers.
5. Workers execute build/test actions in the worker sandbox.
6. Nix builds inside actions use trusted binary caches and, where appropriate, Nix remote builders.
7. Buck2 downloads outputs and reports test status.
8. Repo tooling aggregates Buck event logs, coverage, and high-level verify diagnostics.

The target behavior for developer machines is configurable:

- default local execution for normal iteration
- opt-in RE execution for expensive builds/tests
- no hidden dependency on RE credentials for basic local development
- identical target/test semantics between local and RE modes

### Nix-In-Buck Actions

The hard part is not scheduling. The hard part is that many Buck test/build actions invoke Nix internally. The ideal design is to make those actions valid remote actions rather than bypassing Buck.

Requirements:

- Every action that invokes Nix must declare all source, graph, patch, lockfile, and helper-script inputs through Buck.
- Worker images must provide only Nix and host-level runtime prerequisites. Define `packages.<system>.remote-worker-tools` as the authoritative repo-controlled worker tool closure, containing `bash`, coreutils/`timeout`, Node, Git, Buck2/prelude provisioning, repo helper launchers, and the same tool contract expected by local actions. Optionally expose `apps.<system>.remote-worker-bootstrap` for activation. Backend-specific RE worker binaries and sidecars must be declared Nix packages and composed into the worker closure before repo helpers invoke them. Do not bake repo-controlled tools, language runtimes, Buck binaries, helper CLIs, RE runtime binaries, registration tools, artifact/cache/metrics clients, or credentials into worker images outside declared Nix outputs.
- Workers must trust the same Nix binary caches as CI.
- Developer override env vars must be scrubbed in CI and remote workers.
- Repo wrappers that pass `--builders ""` must do so only for paths that intentionally require local Nix builds; remote-capable wrappers should inherit the configured Nix builder/substituter policy.
- Actions must not read undeclared checkout files through `WORKSPACE_ROOT` unless that checkout or filtered source snapshot is declared as an action input.
- Nix-backed Buck actions must copy required artifacts into declared Buck outputs, or pass exact store paths plus cache identity as declared action data and have the consuming action explicitly realize them with `nix copy --from "$SUBSTITUTER" "$path"` or an equivalent `nix build --no-link --print-out-paths` step before use. Cache publication alone is not a declared action input and does not materialize a store path on the worker.
- `path:$WORKSPACE_ROOT#...` is remote-safe only when `WORKSPACE_ROOT` is the declared action input tree or a declared filtered flake/source snapshot.

### Source snapshot manifest

Remote-ready Nix wrappers that still need `WORKSPACE_ROOT` must use a declared source snapshot
instead of an ambient worker checkout. The snapshot helper lives in
`build-tools/lang/source_snapshot.bzl` and is materialized by
`build-tools/tools/dev/source-snapshot.ts`.

The manifest schema is `viberoots.source-snapshot.v1` and records:

- `declaredSnapshotRoot`: the Buck-declared snapshot directory consumed by the action
- `ambientWorkspaceRoot`: the local checkout used only to construct the snapshot
- `declaredGraphPath`: the declared Buck graph artifact used for the snapshot
- `graphPathInSnapshot`: currently `build-tools/tools/buck/graph.json`
- `excludes`: filtered mutable/local directories
- `files`: files present in the snapshot

Allowed contents are filtered repository source, `flake.nix`, `flake.lock`, the declared graph
artifact, required `TARGETS` and `.bzl` files, and generated provider files. The snapshot must not
contain `.git`, `.direnv`, root `node_modules`, mutable `buck-out`, `.pnpm-store`, `.pnpm-home`, or
local temp directories.

To convert a Nix-invoking wrapper, keep the local command path using the current `WORKSPACE_ROOT`
bootstrap, add `source_snapshot` and `source_snapshot_manifest` as declared inputs for remote-ready
mode, and set remote metadata fields for the declared snapshot root, manifest, and graph path. A
remote-ready target that reads `builtins.getEnv "WORKSPACE_ROOT"` without those declared paths must
remain `remote:local-only`.

- Remote workers should not require broad repo credentials during action execution; source material should arrive through CAS or a declared immutable source artifact.

Where a test truly needs an entire checkout, model that explicitly as a materialized source artifact or a declared test fixture, not as an implicit worker-side clone.

### Scheduler Model

Add a generic remote execution operations subsystem alongside the deployment control-plane schema. This subsystem manages capacity and run metadata; it does not replace Buck2's action scheduler.

Authority boundaries must be explicit:

- Buck2/RE owns action queueing, CAS/action-cache state, action leasing, action retry, and action terminal status.
- The repo control plane owns run envelopes, fleet desired state, worker registration eligibility, external-state locks, object artifacts, operator summaries, and policy decisions derived from Buck event logs.
- Provider autoscalers own cloud-specific instance creation, termination, and quota handling.
- Nix owns binary-cache substitution, closure copying, remote Nix builder selection, and store verification.

New tables or documents should model:

- `runs`: immutable run request, source revision, graph identity, platform matrix, target selectors, policy mode, requester
- `run_children`: per matrix axis/pass execution identity, parent run id, platform, pass name, Buck invocation identity, and aggregation state
- `run_attempts`: CI/client attempt id, Buck invocation identity, terminal outcome, retry cause, and redacted failure summary
- `worker_pools`: provider, region, system, resource class, min/max capacity, launch template identity
- `worker_instances`: provider instance identity, lifecycle class, worker image digest, capability set, registration status, drain state
- `worker_registration_leases`: worker identity, lease expiry, heartbeat, drain/preemption signal; these are not Buck action leases
- `scaling_decisions`: observed demand, desired capacity, current capacity, provider response, budget/quota result, cooldown reason
- `run_outputs`: Buck event log refs, coverage object refs, verify summary, failed targets, Nix paths produced
- `worker_heartbeats`: provider, region, instance type, spot/on-demand class, system, capacity, current action/run, last heartbeat
- `audit_events`: actor, action, object, decision, redaction class, correlation id, timestamp
- `run_locks`: optional lock scopes for deployment-domain tests or tests that mutate shared external state

Every persisted document should carry `schemaVersion`, immutable IDs, idempotency keys where requests can be retried, a closed state vocabulary, terminal outcome fields, redacted error shape, object refs with digest/size/content type, retention policy, and migration strategy. Worker registration states are limited to `registered`, `ready`, `draining`, `preempting`, `expired`, and `removed`. Buck/RE action states are observational copies from Buck event logs or RE metrics, not repo-owned terminal state.

A top-level `run` represents the full CI/developer verification request. Each platform axis and verify pass is represented as a `run_child` under that run. Aggregation succeeds only when every required child succeeds with the same immutable source, graph, Nix, Buck2, RE config, and cache namespace identity.

Reuse the existing deployment control-plane ideas:

- `FOR UPDATE SKIP LOCKED` claim flow
- claim tokens and lease renewal
- explicit fencing before writing terminal output
- immutable object-store artifacts
- idempotency keys
- worker heartbeats and readiness/status surfaces
- containerized worker runtime

Do not reuse deployment-specific lifecycle names, admission policies, Vault/Infisical credentials, or deployment audit records for generic remote execution operations.

### Run Envelope

Each run should carry enough information for CI, workers, and observers to agree on the exact execution context:

```json
{
  "schemaVersion": "vbr-remote-execution-run@1",
  "runId": "run-...",
  "source": {
    "repository": "git@github.com:...",
    "revision": "<full commit>",
    "treeFingerprint": "<source tree fingerprint>",
    "buckGraphFingerprint": "<exported graph fingerprint>",
    "flakeLockFingerprint": "<flake.lock fingerprint>",
    "buck2Version": "<pinned buck2 version>",
    "preludeFingerprint": "<prelude store/source fingerprint>",
    "verifyPlannerVersion": "<verify planner version>",
    "selectedPassPlanFingerprint": "<verify pass plan fingerprint>",
    "reConfigFingerprint": "<RE client/profile config fingerprint>",
    "cacheNamespace": "<nix/cache namespace>"
  },
  "platform": {
    "system": "x86_64-linux",
    "os": "linux",
    "arch": "x86_64"
  },
  "command": {
    "kind": "buck2-re-test",
    "targets": ["//:some_test", "//:other_test"],
    "coverage": false,
    "verifyPassName": "shared"
  },
  "buck2": {
    "remoteExecution": true,
    "remoteProfile": "linux-x86_64-default",
    "targetPlatforms": ["prelude//platforms:default"],
    "executionPlatforms": ["toolchains//platforms:linux-x86_64-re"]
  },
  "timeouts": {
    "overallSeconds": 7200,
    "idleSeconds": 600
  },
  "cache": {
    "substituters": ["https://cache.nixos.org", "https://cache.example.com/vbr"],
    "requiredPublicKeys": ["..."]
  },
  "artifacts": {
    "logsPrefix": "s3://vbr-remote-test/runs/run-..."
  }
}
```

### Worker Runtime

Workers should be disposable RE workers. A worker should be able to start from a minimal image, activate pinned repo-controlled tool closures and the selected backend's worker runtime/sidecars, register capabilities, execute remote actions assigned by the RE scheduler, upload logs/metrics, and disappear.

Linux worker bootstrap:

1. Start from a NixOS or Linux image that contains OS boot services, networking, storage setup, trust anchors, cloud identity/metadata access, Nix, and required sandbox/kernel support.
2. Avoid mutable image-installed repo tools. Git, Node, Buck2/prelude provisioning, and repo helper scripts must come from the pinned `packages.<system>.remote-worker-tools` Nix closure. Backend-specific RE worker runtimes and sidecars must be declared Nix packages and composed into the worker closure before repo helpers invoke them.
3. Configure binary caches and Nix remote builders if this worker delegates expensive Nix builds.
4. Activate the repo-controlled tool closures and backend worker/runtime, then register RE worker capabilities with the scheduler.
5. Warm `.#test-seed`, `.#buck2-prelude`, high-value toolchain attrs, node-module attrs, and selected wheelhouse outputs from cache.
6. Execute REAPI actions assigned by the scheduler.
7. Emit heartbeat, action timing, Nix cache statistics, and preemption/drain state.

Darwin worker bootstrap follows the same registration, cache trust, heartbeat, and reporting contract, but uses a dedicated macOS host lifecycle and cleanup path described in the macOS lane section.

The CI/client command remains normal Buck2, with RE enabled by the selected execution platform and CI config. CI must provide both the configured target platform and `[build] execution_platforms = <registration-target>`, where that target returns `ExecutionPlatformRegistrationInfo` containing one or more `ExecutionPlatformInfo` values whose `executor_config` uses `CommandExecutorConfig(remote_enabled = True, ...)`. `--target-platforms` configures targets; it does not select a remote executor by itself. CI should prefer remote execution explicitly after the selected rule families are marked remote-capable. `EVENT_LOG` must use a Buck2-recognized event-log extension. Prefer `.pb.zst` for compact raw archives; use `.json-lines` or `.json-lines.zst` only when direct text inspection is intentional.

```bash
buck2 --isolation-dir "ci-${RUN_ID}" test \
  --config-file "$RE_BUCKCONFIG" \
  --target-platforms "<target-platform-for-this-axis>" \
  --prefer-remote \
  --unstable-allow-compatible-tests-on-re \
  --event-log "$EVENT_LOG" \
  --build-report "$RUN_ARTIFACT_DIR/buck-build-report.json" \
  --write-build-id "$RUN_ARTIFACT_DIR/buck-build-id.txt" \
  --command-report-path "$RUN_ARTIFACT_DIR/buck-command-report.json" \
  --num-threads "$THREADS" \
  --overall-timeout "${OVERALL_TIMEOUT}s" \
  "${TARGETS[@]}"
```

The selected execution platform, not merely `--target-platforms`, must carry a `CommandExecutorConfig(remote_enabled = True, ...)`. Use `--remote-only` only in conformance lanes where every selected build action and test has a remote-capable executor.

For full `v` parity, this Buck command is the inner execution step, not the whole verify workflow. The verify wrapper must still provide target expansion, pass planning, generated test env after `--`, nested isolation registration, pass logging, safety rails, seed setup, and coverage aggregation.

The worker must not need broad deployment credentials. It needs RE worker credentials, cache read credentials, narrow log/metric write credentials, and optional Nix remote-builder credentials if that worker delegates Nix builds.

### Generated Buck RE Config

`build-tools/tools/remote-exec/render-buckconfig.ts` is the dormant renderer for CI/developer Buck RE config files. It writes `.buckconfig.remote.generated` under an explicit artifact directory such as `buck-out/tmp/remote-exec/<run-id>/`; repo root output is rejected. The renderer does not enable remote execution by itself, and local verify/Jenkins defaults do not read the generated file. A later opt-in lane must explicitly set `VBR_REMOTE_BUCK_CONFIG`.

The verify wrapper accepts remote policy only when explicitly requested with `VBR_REMOTE_EXEC_MODE=hybrid|remote|remote-only-conformance`. Remote verify requires absolute `VBR_REMOTE_BUCK_CONFIG`, `VBR_REMOTE_ARTIFACT_DIR`, and `VBR_REMOTE_TEST_ACTIVATION_DIR` paths plus `VBR_REMOTE_EXEC_SYSTEM=x86_64-linux|aarch64-linux|aarch64-darwin`. Invalid policy fails before local-only verify setup starts. `VBR_REMOTE_TEST_PROFILE_<PASS_NAME>` can override the default `<system-prefix>-default` test profile for a pass; system prefixes are `linux-x86_64`, `linux-aarch64`, and `darwin-aarch64`.

Remote verify passes `--config-file <generated-config>`, `--config-file <activation-dir>/<pass>.buckconfig`, `--prefer-remote` for hybrid/remote lanes, `--remote-only` for conformance lanes, and `--unstable-allow-compatible-tests-on-re`. The generated remote Buck config only enables RE client/platform plumbing; profile maps are inert until the pass-specific activation config reaches Buck analysis. Verify rewrites the pass-specific activation config from the selected profile before spawning Buck, so stale files cannot silently diverge from `VBR_REMOTE_TEST_PROFILE_<PASS_NAME>`. Activation configs contain the selected profile name and the repo-owned execution-platform registration label only, not RE endpoints or credentials. If a remote pass maps to a profile but the activation directory is not selected, verify fails before spawning Buck. Keep the committed `toolchains//:remote_test_execution` default profile unset; do not set a default profile in local toolchain config.

Buck-native artifacts use the shared contract in `build-tools/tools/remote-exec/artifact-contract.ts`. Pass artifacts are written below `VBR_REMOTE_ARTIFACT_DIR/runs/verify/passes/<pass>/`: `buck-event-log.pb.zst`, `buck-build-report.json`, `buck-build-id.txt`, `buck-command-report.json`, `test-executor-stdout.log`, and `test-executor-stderr.log`. Target-scoped wrapper artifacts live under `.../targets/<target>/` and include Nix build logs, selected store-path manifests, raw coverage directories, source snapshot manifests, and remote conformance evidence. Each contract entry defines a content type, digest sidecar path (`<artifact>.sha256`), redaction class, and retention intent.

Failed input/output materialization is disabled by default; set `VBR_REMOTE_MATERIALIZE_FAILED_INPUTS=1` or `VBR_REMOTE_MATERIALIZE_FAILED_OUTPUTS=1` only for debugging runs whose repo-owned metadata is retained under `.../failed-materialization-policy.json` with `debug-on-failure` retention and `sensitive-debug` redaction for materialized inputs/outputs. The pinned Buck2 flags are bare `--materialize-failed-inputs` and `--materialize-failed-outputs`, so the verify wrapper records retention-scoped metadata under the artifact directory instead of claiming Buck accepts a materialization output path. Verify logs include the selected profile and a redacted generated-config fingerprint such as `config_fingerprint=sha256:0123456789abcdef`; they do not print the config path or secret-bearing config contents.

The Buck process environment and the test environment after Buck's `--` delimiter are mode-specific. Local mode keeps the existing local payload, including seed-store diagnostics, local Nix daemon settings, and local coverage paths. Remote mode uses remote-specific allowlists for both the Buck process and test child env. It forwards only values that are meaningful inside a remote action sandbox: timeouts, `COVERAGE=0`, the nested Buck isolation name, generated remote-safe Pnpm/Nix settings, pinned tool paths, and known certificate paths. Host-local paths are rejected unless they are represented through declared artifacts, generated config references, materialization manifests, pinned tool paths, or known certificate paths. Remote mode never forwards Nix daemon sockets, repo-root `buck-out`, `.direnv`, root `node_modules`, local seed pin directories, local `NODE_V8_COVERAGE`, `TEST_RSYNC_ROOTS`, or developer override env vars.

Nix impure env values in the root flake and `build-tools/tools/nix/flake/nix-config.nix` must stay classified in `build-tools/tools/dev/verify/buck2-test-env-policy.ts`. Add new values only with a remote-safe or local-only classification. Remote-safe values must be backed by declared source snapshots, graph artifacts, materialization manifests, exact Nix-store paths, or per-target policy fields; otherwise keep them local-only and out of the remote test environment.

Renderer inputs are explicit: engine/CAS/action-cache endpoints, instance name, auth mode, target system/profile, fallback policy, and event/report artifact directory. Supported fallback policy values are `strict-remote`, `hybrid`, and `local-only`; none is selected implicitly.

Auth input must be file-backed or environment-backed. mTLS values are paths or environment references, never inline PEM. `http_headers` is a Buck header list, and bearer/API-key-looking values must be supplied through environment references. Renderer summaries include only the config fingerprint; endpoint, artifact path, policy, platform, and credential material are not printed as success evidence.

Use `build-tools/tools/remote-exec/remote-buckconfig.example.json` as the fixture shape. It uses only `example.invalid` endpoints and fake environment references.

### Credential Contract

Remote execution credentials must follow the same bias as the deployment control plane: explicit, narrow, file-backed or workload-identity-backed, startup-validated, rotated, and redacted.

Separate roles:

- CI Buck2 RE client credential
- RE worker registration credential
- CAS/action-cache read/write credential
- Nix binary cache read credential
- Nix binary cache write credential for trusted publishers only; signing credentials only when the cache backend requires publisher-side signing
- object-store write credential scoped to run logs/artifacts
- metrics/logs write credential
- Nix remote-builder SSH credential
- deployment-domain test credential, granted only to locked external-state test lanes

Rules:

- No secrets in ambient env, Buck logs, Nix store paths, action cache keys, or persisted run summaries.
- Credentials must have TTL, rotation, revocation, and owner metadata.
- Workers should prefer workload identity, mTLS, OIDC, or SPIFFE/SPIRE-style identity over long-lived static tokens.
- Child process env must be scrubbed before invoking Buck, Nix, test runners, or deployment helpers.
- A run summary may reference credential role names and fingerprints, never secret material.
- Buck2/Nix credential paths must be explicit config paths, not inherited from broad shell state.
- Cache signing keys are either held by the cache service/host or available only to publisher jobs for locally signed stores; worker and developer identities get read-only cache credentials.
- Authenticated `s3://` cache reads must use workload identity or instance-role credentials outside the action env. Prefer HTTPS substituter URLs for read-only worker configuration when possible.
- Credential-use audit events record role, subject, fingerprint, and operation, never token material or file contents.
- Credentialed tests receive declared credentials only through file-backed mounts, workload identity, or a narrow explicit env allowlist owned by the test rule. Those credential inputs are excluded from CAS/action keys, Buck logs, Nix logs, and run summaries except for redacted role/fingerprint metadata.

### Target Partitioning

Prefer Buck2 action-level scheduling through REAPI. Use repo-level target batching only as an explicit policy layer around Buck, not as a second execution engine.

The target-selection layer should:

1. Run the same target-selection logic used by `v` or CI.
2. Expand recursive selectors to concrete Buck test labels when policy requires pass partitioning.
3. Preserve label-driven semantics:
   - `verify:isolated` currently maps to pass partitioning and `--num-threads 1`; the remote design must add an explicit Buck executor/profile selection if isolated tests should use dedicated remote capacity.
   - `verify:resource-limited` currently maps to pass partitioning and a 4-thread cap; the remote design must add an explicit Buck executor/profile selection if these tests should use larger resource units or lower remote concurrency.
   - shared tests use the default remote profile.
4. Keep deployment-domain tests behind explicit locks and credential boundaries.

Timing data should come from Buck2 event logs and existing verify logs. The repo should not invent a parallel action telemetry format.

### Action Classes And Retry Policy

Every remote-capable rule/test family must declare an action class:

- `pure_retryable`: no external side effects; Buck2/RE may retry freely.
- `external_readonly`: reads external services; retryable with bounded retry and stable credentials.
- `external_mutating_locked`: mutates shared external state; requires a repo-control-plane lock, idempotency key, attempt record, and in-doubt reconciliation.
- `local_only`: cannot run remotely until the contract is fixed.

Preemption handling depends on the class. `pure_retryable` actions rely on Buck2/RE retry. `external_mutating_locked` actions require fenced authority before terminal writes, partial-output capture, and explicit recovery logic before the lock can be released or the action retried.

The authoritative declaration surface is a Buck-visible policy attribute or label exported into graph metadata and checked by the verify planner before remote opt-in. Sidecar manifests may summarize policy, but they must be generated from or validated against Buck-visible metadata so policy cannot drift from target definitions.

Retry contract:

- `pure_retryable`: Buck/RE owns action retry with bounded max attempts and backoff recorded in Buck/RE metrics.
- `external_readonly`: Buck/RE retry is allowed within a run-level max-attempt budget; failures record provider/service category.
- `external_mutating_locked`: repo control plane creates a new `run_attempt` for run-level retry, records `in_doubt` when the worker dies before fenced terminal evidence, and requires recovery evidence before releasing `run_locks`.
- `local_only`: no remote retry; failures remain local/CI failures until the rule family is made remote-capable.

### Spot Capacity Across Providers

Use a provider-neutral worker registration model:

- AWS EC2 Spot for `x86_64-linux` and `aarch64-linux`
- GCP Spot VMs for overflow Linux capacity
- Azure Spot VMs only if cache/network behavior is acceptable
- macOS uses either a dedicated macOS RE worker pool or a local-execution lane with the same run metadata and reporting contract

For cheap on-demand Linux capacity, use EC2 Spot instances as disposable servers, not Fargate tasks, as the default worker substrate. Build/test workers need Nix, sandbox support, large local disks, predictable process execution, worker-side cache warming, preemption handling, and backend-specific RE worker daemons. EC2 Spot exposes those host-level controls directly and can be diversified across instance families and Availability Zones. Fargate is a reasonable always-on service host for simple containers such as `atticd`, but it is not the first choice for Nix remote builders or Buck2 RE workers.

Use two worker roles even when they share the same image family:

- Nix remote builders: NixOS or Linux EC2 Spot instances reachable by CI or worker hosts over SSH, listed through generated `/etc/nix/machines`, trusted by remote `nix-daemon`, configured with the organization binary cache, and sized for store-build throughput.
- Buck2 RE workers: EC2 Spot instances running the selected RE worker runtime/sidecars, registering platform properties with the RE scheduler, executing Buck build/test actions from CAS inputs, and using the Nix binary cache and optional Nix remote builders from inside actions.

Do not use AWS Batch as the primary scheduler for Buck2 tests. AWS Batch is useful for coarse batch jobs and managed Spot compute environments, but Buck2 RE must remain the action scheduler for distributed build/test execution. Placing Batch between Buck and workers would create a second action scheduler, weaken Buck's retry/cache semantics, and make per-action logs/capabilities harder to reason about. AWS Batch can still be useful for separate maintenance jobs such as image prewarming, cache conformance checks, or one-shot fleet diagnostics.

Use instance diversification and fallback policy deliberately:

- Prefer Graviton Spot pools for `aarch64-linux` when the repo's target graph supports them; use `c7g`, `m7g`, and newer generation equivalents for CPU-heavy work, with memory-optimized families only for tests that need them.
- Keep `x86_64-linux` pools for targets that require x86, native addons, or parity with deployment artifacts.
- Use EC2 Auto Scaling groups, EC2 Fleet, or an ECS-on-EC2 capacity provider with a price/capacity-optimized allocation strategy across multiple instance families and AZs.
- Maintain scale-to-zero for low-priority queues, a small warm pool for interactive CI, and bounded On-Demand fallback only for high-priority or deadline-bound runs.
- Keep all mutable repo tools out of AMIs; workers activate pinned Nix closures on boot, then register only after cache trust, tool activation, and sandbox checks pass.

The RE scheduler should not know provider-specific APIs. Workers register RE platform properties/capabilities and use-case/resource metadata understood by the selected RE backend. Repo Buck profile names are control-plane aliases only and must map to `remote_execution_properties`, `remote_execution_use_case`, and resource fields before Buck invokes RE. The provider-neutral registration shape is:

```json
{
  "workerId": "aws-us-east-2-c7g-spot-...",
  "provider": "aws",
  "region": "us-east-2",
  "lifecycle": "spot",
  "system": "aarch64-linux",
  "cpu": 16,
  "memoryGiB": 32,
  "resourceClasses": ["default", "resource-limited"],
  "remoteExecutionProperties": {
    "platform": "linux-aarch64",
    "resource_class": "large"
  },
  "remoteExecutionUseCases": ["buck2-build", "tpx-default"]
}
```

Provider-specific autoscalers should only translate queue depth and platform demand into instance counts.

Autoscaling contract:

- Inputs: RE queue depth by backend platform properties/use case/resource class, observed action runtime, worker readiness, cache pressure, preemption rate, provider capacity errors, budget caps, and CI priority.
- Outputs: desired worker count per provider/region/resource class, warm-pool size, on-demand fallback request, or scale-to-zero decision.
- Controls: cooldowns, hysteresis, min/max capacity, price ceiling, quota handling, per-provider failure backoff, and region/cache-locality preference.
- Audit: every scaling decision writes observed demand, desired/current capacity, provider response, and budget/quota result.

Demand source of truth:

- The RE scheduler API or metrics endpoint is authoritative for queued/running action demand by backend platform properties/use case/resource class.
- Buck event logs are authoritative for completed action timing and retry outcomes.
- Repo DB run records provide priority, policy, source identity, and lock context.
- Autoscalers must reject stale demand snapshots, record the snapshot timestamp, and apply cooldowns before scaling down.

Preemption handling:

- Workers catch cloud metadata preemption notices when available, but they must not assume a uniform drain window. Treat notice as best-effort and provider-specific: AWS EC2 Spot normally provides a two-minute interruption notice except hibernation; GCP Spot VMs default to notice at the start of a best-effort shutdown period up to 30 seconds, with 120-second preemption notice in Preview where available; Azure Spot VMs can use Scheduled Events, with attempted delivery up to 30 seconds before eviction.
- They stop accepting new RE actions immediately.
- They mark the worker registration lease as preempting and keep uploading logs until shutdown.
- The repo control plane drains or removes the worker registration after lease expiry. Buck2/REAPI retries the affected action according to the configured retry policy.

Provider conformance requirements:

- instance identity can be verified
- preemption notice is observable and tested
- worker clock sync is within tolerance
- CAS/cache/object-store network paths are available
- filesystem and sandbox behavior match the worker profile
- shutdown grace is measured
- IAM scope is minimal and tested
- object-store compatibility includes digest/size/content-type checks
- cache locality and cross-region transfer costs are visible

### macOS Lane

The `aarch64-darwin` lane must use the same run envelope, event-log ingestion, result aggregation, and policy gates as Linux.

Supported modes:

- dedicated remote macOS RE workers
- dedicated local macOS executors reporting into the same run/control-plane model

macOS-specific requirements:

- explicit host lifecycle and capacity model; avoid pretending macOS spot capacity behaves like Linux spot. On AWS, macOS capacity means EC2 Mac Dedicated Hosts, On-Demand, or Savings Plans, not Spot.
- Nix installed and cache-trusted under the same feature floor
- no keychain, codesigning, or Apple credential material in generic RE workers unless a test explicitly declares that credential class
- sandbox and filesystem differences documented in the worker profile
- long-lived host drift detection, image/bootstrap reproducibility, and cleanup of Buck/Nix temp state between runs

### Result Aggregation

Buck2 success is necessary but not sufficient. A top-level verify run succeeds only when required preflights, seed/prewarm setup, every Buck pass, coverage aggregation when enabled, and artifact publication/reporting all succeed for the same source, graph, Nix, Buck2, RE config, and cache namespace identity.

Aggregation should produce:

- final status
- failed Buck targets
- links or object refs for logs
- per-action duration and worker metadata
- coverage merge input refs when coverage is enabled
- cache miss/build summary when available

For coverage, do not let remote actions write directly into the repo `coverage/` directory. Remote `--coverage` stays fail-fast until raw V8 coverage outputs are declared per test under the artifact contract and verify aggregation can materialize them locally before running the existing `pnpm coverage:build` normalization/merge step. Local coverage remains unchanged.

### Observability Contract

Remote execution must provide an operator surface, not just logs.

Required surfaces:

- `/healthz` and `/readyz` for the repo control plane
- worker heartbeat/status API
- run status API keyed by run id, source revision, and CI attempt
- Buck event log references for every run
- Buck-native build reports, build IDs, and command reports for every Buck invocation
- structured logs with correlation IDs spanning CI, Buck invocation, RE action, worker, CAS/cache, Nix build, and object-store writes
- audit log for scaling, credential use, lock acquisition, lock release, retries, and terminal outcomes

Required metrics and alerts:

- run queue age by platform/profile
- desired vs current worker capacity
- worker registration failures
- spot preemption rate
- RE retry rate
- action cache hit rate
- CAS size/pressure/error rate
- Nix binary cache hit rate
- Nix remote-builder failures
- slowest actions/tests
- stuck run/action detection
- external-state lock age
- artifact upload failure rate
- redaction violation count

All operator outputs must use defined redaction classes. Secret values, tokens, signing keys, SSH keys, and deployment credentials must never appear in Buck logs, worker logs, Nix logs, run summaries, or audit events.

Redaction classes:

- `public`: safe for logs, dashboards, and PR comments.
- `internal`: safe for authenticated operators; not emitted to public artifacts.
- `sensitive_identifier`: account IDs, hostnames, repository URLs, object refs, credential fingerprints; visible only in authenticated operator views.
- `secret`: tokens, private keys, signing keys, session cookies, deployment credentials; never logged or persisted outside approved secret stores.
- `regulated`: user/customer data or external-service payloads; excluded from remote execution logs unless a test-specific policy allows redacted summaries.

## Buck2 REAPI Design

Buck2 REAPI is the built-in mechanism this repo should use for distributed build and test execution.

Activation requires:

- adding `[buck2_re_client]` config in `.buckconfig` or an included local/CI config
- configuring authentication and TLS for the RE endpoint
- adding at least one non-empty profile to `toolchains//:remote_test_execution` for test execution
- keeping repo-owned test rules (`zx_test`, Node, Go, C++, and Python Nix tests) on their local default while allowing selected profiles to pass the chosen executor fields into `ExternalRunnerTestInfo`; Node, Go, C++, and Python selection is per-target, while `zx_test` also honors the PR7 `[test] viberoots_remote_profile` activation config
- auditing Rust Nix build rules separately as build-action RE candidates; this repo does not currently expose a Rust external-runner test wrapper
- ensuring remote-capable external-runner tests set `use_project_relative_paths = True` and `run_from_project_root = True`; CI may pass Buck2's `--unstable-allow-compatible-tests-on-re` only to allow compatible tests to run on RE, not to make incompatible tests compatible
- adding a remote-enabled execution platform/executor config for build actions; the test remote execution toolchain alone does not make ordinary build/genrule actions remote
- opting rule families into remote build execution only after their actions are hermetic
- ensuring worker images can run actions that invoke Nix
- proving that action inputs do not rely on undeclared host paths or volatile env

Linux and Darwin should be designed under one profile model. If Darwin capacity is scarce or expensive, the Darwin lane can use local execution while preserving the same run metadata, result aggregation, and policy gates.

Buck2 RE and Nix remote builders are complementary:

- Nix remote builders distribute Nix store builds over SSH.
- Buck2 RE distributes Buck actions through REAPI/CAS.
- The repo-owned control plane manages spot capacity, policy, credentials, and observability around the Buck/Nix engines.

Do not conflate their caches. A Nix binary cache stores Nix closures. A Buck/RE CAS stores action inputs and outputs. A remote-test object store stores run logs, coverage, event logs, and structured summaries.

### Buck2 Configuration Shape

The repository should keep developer defaults local and make RE activation explicit through CI or an opt-in include.

Example shape, intentionally incomplete until validated against the pinned Buck2 commit. Use `grpc://` or omit the scheme; TLS is controlled by Buck2 RE client config, not by a `grpcs://` scheme. Use provider-specific RE client keys validated against the pinned Buck2 commit: local insecure BuildBarn-style setups may require `tls = false`; mTLS providers should use `tls_client_cert` and optionally `tls_ca_certs`; token-based providers should use `http_headers`. Source secret values from explicit CI-owned files or workload identity rather than ambient env, and do not treat `tls = true` as a complete authentication configuration:

```ini
[buck2_re_client]
engine_address = grpc://re.example.com:443
cas_address = grpc://cas.example.com:443
action_cache_address = grpc://ac.example.com:443
tls = true
```

The concrete keys must match the pinned Buck2 commit's supported config. Current Buck2 documentation describes `[buck2_re_client]` endpoint, TLS, and HTTP-header settings; do not invent local enablement keys unless the pinned Buck2 commit supports them. The design requirement is that CI can generate or include RE config without forcing every developer to hold RE credentials.

The `toolchains//:remote_test_execution` target should define named profiles by worker class:

- `linux-x86_64-default`
- `linux-x86_64-large`
- `linux-aarch64-default`
- `linux-aarch64-large`
- `darwin-aarch64-default` when remote Darwin workers are available

Profiles should use only the keys accepted by the pinned Prelude profile schema. Each named profile must include:

- `capabilities` passed into `CommandExecutorConfig.remote_execution_properties`
- `use_case` for the remote execution request

Optional profile keys are:

- `listing_capabilities` when test listing needs a different worker class
- `remote_cache_enabled`
- `dependencies` for remote execution dependencies
- `local_enabled` and `local_listing_enabled` fallback policy
- `resource_units` for large/resource-limited profiles
- `remote_execution_dynamic_image` when the pinned Buck2 commit and RE backend support dynamic image selection

Do not add profile keys such as `fallback_policy`, `worker_image`, or `platform` unless they are represented as supported `capabilities`, `remote_execution_dynamic_image`, or build-execution-platform `CommandExecutorConfig` fields.

Choose fallback behavior explicitly for every profile. Omit or set `local_enabled = False` for strict RE-only CI profiles; set `local_enabled = True` only for hybrid/fallback lanes. Do not assume `--prefer-remote` adds local fallback when the selected test profile's `CommandExecutorConfig` is RE-only.

When setting `default_profile`, set `default_run_as_bundle` deliberately. The pinned Prelude defaults bundling to true when a default profile exists. Use `False` unless bundled-suite behavior has been validated against verify pass partitioning, timeouts, retries, and log/coverage aggregation.

Profiles are not sufficient by themselves for this repo's current external-runner tests. The Node, Go, C++, Python, and `zx_test` wrappers expose a `remote_execution` attribute using Prelude's RE test argument schema, translate selected profiles with Prelude's `get_re_executors_from_props(ctx)` helper, and pass Buck's executor fields through to `ExternalRunnerTestInfo`. Node, Go, C++, and Python defaults remain `remote_execution = None`; `zx_test` uses an empty-string local sentinel from `read_config("test", "viberoots_remote_profile", "")` so PR7 activation config can select a profile without per-target attrs. Rules set `run_from_project_root = True` and `use_project_relative_paths = True` explicitly to make path behavior auditable.

This propagation is intentionally inert readiness plumbing. Do not mark a wrapper family `remote:ready` only because these executor fields exist. Remote-ready wrapper commands must use a separate declared command source and attach rule-owned files to the executed `ExternalRunnerTestInfo.command` with `cmd_args(..., hidden = declared_inputs)` rather than reusing the local bootstrap shell or relying on unrelated stamp actions. For `zx_test`, the declared set includes the test script, template inputs, `zx-init.mjs`, `command-heartbeat.ts`, and `node-modules-build.ts`. For Node, Go, Python, and C++ Nix tests it includes the wrapper's source/Nix input lists plus the helper launchers and local manifests they currently invoke, such as `build-selected.ts`, `nix-build-filtered-flake.ts`, `prepare-exact-pnpm-store.ts`, `zx-init.mjs`, `graph.json`, and `workspace-root.env`. The plain workspace-string/bootstrap command shape remains the local-only path.

Declared command handles are necessary but not sufficient. Remote-enabling these wrappers still requires replacing broad `WORKSPACE_ROOT`/`FLK_ROOT` lookups with a materialized source snapshot and Nix closure contract. Merely passing `default_executor`, `executor_overrides`, or command handles is insufficient while test commands read arbitrary paths through `WORKSPACE_ROOT`, `FLK_ROOT`, generated Buck config, helper TypeScript files, `.git`, or temp workspaces outside Buck's declared input model.

Build-action RE needs separate configuration from test RE. The current Prelude default platform is local-only, so the design must add a repo execution-platform registration target for remote-capable build actions and point CI `[build].execution_platforms` at that registration target. The registration target must return `ExecutionPlatformRegistrationInfo` containing one or more `ExecutionPlatformInfo` values. Each remote-capable `ExecutionPlatformInfo.executor_config` must set `remote_enabled = True`, explicit `local_enabled`, explicit `use_limited_hybrid`, `remote_execution_use_case = "buck2-build"`, and the same capability vocabulary used by test profiles through `remote_execution_properties`. Test profiles and build execution platforms should share the same worker capability vocabulary, but they are not the same Buck configuration surface.

### Hermeticity Audit

Before marking a rule family remote-capable, audit it for:

- undeclared reads through `WORKSPACE_ROOT`
- undeclared reads from `.git`, `buck-out`, `.direnv`, `node_modules`, or temp dirs
- volatile env use
- writes outside declared outputs
- Nix invocation that depends on local store paths not available through cache or declared inputs
- network access during actions
- reliance on developer override env

The expected fix is not to disable remote execution broadly. The expected fix is to declare inputs, move volatile setup into preflight or Nix-provided worker closures, and make remote workers match the local action contract. Baking mutable tools into images is an exception for host-level dependencies only, not the default path for repo tool dependencies.

## Implementation Plan

### Phase 1: Establish Shared Cache And Worker Images

1. Pick the binary cache backend and signing model.
2. Configure CI agents with substituters and trusted keys.
3. Set `NIX_CACHE_TO` for `wheelhouse-preload`.
4. Add targeted cache push steps for `.#graph-generator`, graph-materialization outputs produced with `BUCK_GRAPH_JSON`, `.#test-seed`, and high-value toolchain attrs.
5. Archive the exact flake source and locked inputs with `nix flake archive`, populate the selected cache backend using its supported writable-store or push flow, and publish a cache hydration manifest per CI axis containing the exact wheelhouse/toolchain/test-seed output paths, flake archive metadata, cache endpoint, system, source revision, and flake lock fingerprint.
6. Define `packages.<system>.remote-worker-tools` as the authoritative repo-controlled worker tool closure and, if useful, `apps.<system>.remote-worker-bootstrap` as the activation command.
7. Document how developers opt into builders despite `.envrc`'s default empty builder config.
8. Build Linux worker images with host-level prerequisites, Nix, cache trust config, cloud identity plumbing, and sandbox support; realize `packages.<system>.remote-worker-tools`, and compose the selected backend's worker runtime/sidecars into declared Nix package outputs before repo helpers invoke them.
9. Define the macOS lane mode: remote Darwin RE worker pool or local Darwin executor reporting into the same run model.
10. Add a TypeScript zx smoke test under `build-tools/tools/...` that prints effective `NIX_CONFIG`, verifies builder reachability, builds `.#graph-generator --rebuild`, and has focused tests for config rendering/parsing.

### Phase 2: Configure Buck2 RE

1. Add CI-generated or included `[buck2_re_client]` config.
2. Configure non-empty `toolchains//:remote_test_execution` profiles.
3. Wire repo-owned external-runner test rules to Buck's remote execution selection fields.
4. Add a remote-enabled build execution platform/executor config separate from test RE profiles.
5. Replace or extend `run-stage.ts --stage buck-test` so Jenkins invokes the verify pass planner, or `v`, with generated RE config per pass. A direct `buck2 test` command is not a valid remote CI entrypoint because it bypasses verify seed setup, pass partitioning, safety rails, nested isolation registration, and coverage aggregation.
6. Extend the verify pass model with an explicit executor/profile field per pass, then have `spawnVerifyBuck2Tests` apply the generated Buck config/options for isolated, resource-limited, and shared passes. Keep thread caps independent from remote worker resource-class selection.
7. Add target/rule-family controls for remote-capable, local-only, isolated, and resource-limited execution.
8. Persist Buck-native artifacts first: raw event logs with `--event-log` to a Buck2-recognized event-log path, preferably `${RUN_ARTIFACT_DIR}/buck-event-log.pb.zst`, `--build-report`, `--write-build-id`, and `--command-report-path`. Add newer Buck2 report flags only after they are verified against the pinned Buck2 commit.
9. Derive run summaries from Buck-native log commands before adding repo-specific fields: `buck2 log what-ran`, `summary`, `critical-path` or `slowest-path`, `what-uploaded`, and `what-materialized`.
10. Verify representative build and test actions with `buck2 log what-ran --format json "$EVENT_LOG"`. Treat JSON output as pinned-version JSONL. Classify `record.reproducer.executor === "Re"` as remote execution, `Cache` as action-cache hit, `ReDepFileCache` as dep-file-cache hit when allowed for the lane, and `CacheQuery` as diagnostic-only, not proof of execution. Fail on `Local`, `Worker`, or `WorkerInit` for remote-capable actions unless the target is explicitly local-only. Keep this parser covered by pinned-version tests. Treat direct event-log protobuf parsing as pinned-version code, not a stable schema.
11. Keep local developer execution working without RE credentials.

### Phase 3: Add Spot Capacity Control Plane

1. Define run, attempt, worker-pool, worker-instance, worker-registration-lease, scaling-decision, heartbeat, audit, lock, and output schemas separate from deployment submissions.
2. Reuse existing backend patterns for claims, leases, fencing, locks, heartbeats, and object artifacts.
3. Define the authority boundary between Buck/RE, repo control plane, provider autoscalers, and Nix.
4. Support AWS and one second provider behind the same worker registration contract.
5. Autoscale worker pools from queued Buck/RE demand, platform demand, and observed action runtime.
6. Implement drain/preemption handling that lets Buck2 retry affected actions.
7. Add provider conformance tests.
8. Add macOS lane conformance tests for drift checks, cleanup validation, and reporting parity.

### Phase 4: Make Rule Families Remote-Capable

1. Audit Node, Go, C++, Python, Rust, deployment-domain tests, and zx tests for hermetic remote execution.
2. Fix undeclared inputs and local checkout assumptions.
3. Before marking any selected-target or verify-seed action remote-capable, remove workspace out-link creation and use declared Buck outputs/store-path realization, or record an explicit accepted exception with remote-worker cleanup and GC-root semantics.
4. Ensure Nix-backed Buck actions produce declared Buck outputs, or explicitly realize declared store paths from the configured cache before downstream use.
5. Map `verify:isolated` and `verify:resource-limited` labels to explicit Buck executor/profile selection, preserving their current pass/thread semantics.
6. Add raw coverage upload and final merge.
7. Add deployment-domain execution with explicit locks, action classes, idempotency, and credential boundaries.

### Phase 5: Enforce The Remote Contract

1. Add CI checks that fail when remote-capable actions read undeclared inputs or rely on forbidden env.
2. Add policy docs for local-only exceptions.
3. Track local/remote parity by target and rule family.
4. Publish run summaries with remote hit rates, action retries, worker preemptions, Nix cache hits, and slowest actions.
5. Add health/readiness APIs, alerts, structured logs, audit events, and redaction checks.
6. Keep local and remote execution semantically identical.

### Production Acceptance Boundary

The production design is complete only when these conditions are true:

- one Buck2-compatible RE backend serves all configured cloud worker pools
- Linux default and large profiles exist for both `x86_64` and `aarch64`
- `verify:isolated` and `verify:resource-limited` map to explicit Buck executor/profile selection while preserving their pass and thread semantics
- AWS and at least one second cloud provider pass provider conformance behind the same worker registration contract
- the `aarch64-darwin` lane uses the same run envelope, result aggregation, policy gates, and operator reporting as Linux, whether its execution capacity is remote RE or dedicated local/on-demand macOS hosts
- no repo-owned action scheduler exists
- no custom action telemetry format exists beyond Buck event logs, RE metrics, Nix logs, and repo run summaries
- `external_mutating_locked` tests remain local-only unless locks, idempotency, fencing, and recovery evidence are implemented and tested

## Troubleshooting

- Startup check fails for Nix features: ensure `nix-command flakes` are present in `nix config show` or `NIX_CONFIG`.
- Remote builder is not used: inspect effective `NIX_CONFIG`; `.envrc` may have installed `builders =` empty, or a wrapper may pass `--builders ""`.
- Cache misses are high: verify the same flake lock, same system, same source revision, no dev override env, and trusted substituters on clients and builders. Content-addressed derivations can be evaluated as cache policy, but they are not required by the current repo.
- Cache downloads are too large or slow: use cache compression and store optimization, place workers close to the cache, and make cross-region transfer costs visible in autoscaling metrics.
- Buck2 tests are not remote: expected today. Buck2 RE is not configured yet.
- macOS upload or notarization warnings appear: not relevant to ordinary Nix store binaries, but CI upload/signing steps outside Nix need their own organization policy and credentials.
- Spot workers lose progress: expected under preemption unless Buck2/REAPI retries the affected action or the action produced a fenced terminal result.

## FAQ

**Do we need repo changes to use remote Nix builders?**

Mostly no, but CI and developer shell configuration need care. Some repo wrappers intentionally disable builders, and `.envrc` defaults to an empty builders config unless one is already present.

**Do remote Nix builders make `v` distributed?**

No. They can accelerate Nix builds spawned during tests, but Buck still schedules and runs test actions from the invoking machine.

**Should we use Buck2 REAPI as the target design?**

Yes. Buck2 REAPI is the right execution layer. Custom repo code should make Buck2 RE practical on spot capacity and with Nix-backed actions; it should not replace Buck's remote execution engine.

**Can spot workers be multi-cloud?**

Yes, if the worker-registration and autoscaling layer is provider-neutral, while Buck2/RE remains the only action scheduler, and all workers use the same source identity, Nix cache, object store contract, and platform capability model.
