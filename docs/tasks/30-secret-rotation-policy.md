# 33. Secret Rotation Policy & Workflows

**Tier:** Security Hardening
**Priority:** 33 of 44
**Depends on:** #1 Infisical Secrets Provider, #7 Auth Provisioning IaC
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Define rotation schedules and procedures for all credential classes, then implement the `--rotate-*` tooling and `refreshMode` semantics that make rotation safe for in-flight admitted runs without breaking replay or rollback.

## What

Define and implement a documented, operationally consistent rotation policy for every secret
category used by viberoots deployments, and wire the minimum tooling needed to execute rotation
safely without interrupting in-flight work.

The system already has a working two-backend secrets architecture — Infisical as default, Infisical as
an additive peer — and a contract layer (`SprinkleRef`) that keeps repo metadata backend-neutral.
What is missing is an end-to-end answer to "what do I do when a credential needs to change?"

**Secret categories requiring rotation policy:**

1. **Bootstrap credentials** — Infisical Universal Auth client secrets stored in macOS Keychain or
   local file. These are the root credentials to reach a secret backend. They are currently issued
   with `clientSecretTtl: 0` (no expiry) and `accessTokenTtl: 3600` (1-hour derived access
   tokens). The bootstrap tool already has `--rotate-bootstrap-credentials
--force-overwrite-local-credentials` to issue a new Infisical client secret for this machine and
   overwrite the local sink. There is no policy for when or how often operators should use this,
   what to do when a machine is decommissioned, or how to revoke a leaked credential promptly.

2. **Deployment workload credentials** — Infisical Universal Auth client secrets for each
   deployment machine identity (e.g. the Pleomino per-stage identities provisioned by
   `infisical-bootstrap.ts deployment`). The bootstrap tool has
   `--rotate-deployment-credentials --force-overwrite-local-credentials` for this. The identity
   config sets `lockoutEnabled: true` with a threshold of 3 and a 300-second lockout duration to
   limit brute-force attempts, but there is no stated rotation schedule or incident-response
   procedure for a suspected leak.

3. **Infisical JWT role tokens** — short-lived Infisical tokens minted during deployment via JWT auth. The
   role is configured with `token_ttl="30m"` and `token_max_ttl="2h"`. These expire naturally and
   never touch disk or `process.env`, so rotation means rotating the underlying Keycloak client
   credentials (`deployment-runner` client secret) and the Infisical JWT auth configuration that
   validates the OIDC issuer and bound claims. There is no runbook for this.

4. **Keycloak client secrets** — the `deployment-runner` confidential OIDC client secret used by
   CI/Jenkins to exchange for Infisical-bound JWTs. The bootstrap runbook says to create an operator
   account and "rotate the bootstrap password immediately after first use" but does not define an
   ongoing rotation cycle or automated revocation path for Jenkins-bound secrets.

5. **Provider API keys** — Cloudflare API tokens, Vercel tokens, database URLs, and similar provider
   credentials stored as `secret://deployments/...` contracts in Infisical or Vault. The Infisical
   bootstrap runbook includes a minimal rotation procedure (write new KV version, verify one
   deployment run reads the new value, regenerate any fixture exports that reference the old value).
   The Vault equivalent is not documented.

6. **Postgres deployment service database URL** — passed as
   `VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL` to the control plane. No rotation policy exists.

7. **Control plane bearer token** — `VBR_DEPLOY_CONTROL_PLANE_TOKEN`, the static secret the
   control plane uses to authenticate inbound deployment submissions. No rotation policy exists.

**What this task implements:**

- A rotation runbook per category above, embedded in the relevant docs. Each runbook covers:
  how to issue the replacement credential, how to verify the new credential resolves through the
  reviewed runtime path before removing the old one, and how to confirm in-flight deployments are
  not disrupted.
- A policy for bootstrap credential rotation: minimum rotation trigger conditions (machine
  decommission, suspected leak, periodic operator review), how to revoke a specific machine's
  Infisical client-secret record in the Infisical console while leaving other machines' records
  intact, and how to confirm revocation did not break any pending deployment runs.
- Documentation of the `refreshMode` contract as it applies to rotation: `refreshMode: "none"`
  means admitted references are version-pinned and a rotated secret does not affect in-flight
  replay; `refreshMode: "reacquire"` means the runtime fetches a fresh credential before each step
  and rotation takes effect immediately. Operators must understand which mode applies to each
  category before rotating.
- Guidance for the replay safety invariant: a `retry` or `rollback` of an Infisical-admitted run
  uses the frozen `resolvedVersion` in the admitted reference, not the current live value; rotating
  the live Infisical secret does not invalidate in-flight retries unless the old version is
  explicitly deleted from Infisical version history.
- A decommission checklist for removing an operator machine from the bootstrap identity: revoke
  the machine's labeled client-secret record in Infisical, confirm that `projects/config/local.json`
  on that machine no longer selects credentials for the revoked identity, and verify active deployment
  runs were not
  mid-execution on that machine's credential.

## Why Now

This task becomes necessary as soon as any of the above credentials reaches production use at
scale. The deployment contract already specifies that `retry` and `rollback` must fail closed if
admitted references are revoked or cannot be resolved exactly — but there is no policy for how
operators should rotate credentials while honoring that contract. Without a documented procedure,
an operator rotating a Cloudflare API token during an in-flight deployment risks breaking the
deployment's replay path, or (for `refreshMode: "reacquire"` credentials) causing the running
worker to fail mid-step when it next tries to acquire the credential.

The Infisical bootstrap and `i` tooling already expose `--rotate-bootstrap-credentials` and
`--rotate-deployment-credentials`, which means the mechanical act of rotation is already possible.
This task adds the policy and guidance layer so operators know when and how to use those flags
safely.

The task is also gated on #1 (Infisical provider) being fully wired because:

- the dual-backend model means rotation procedures must exist for both Infisical-backed and
  Infisical-backed deployments, and the Infisical runtime worker credential path is still being
  hardened
- the `i --rotate-*` flags are the primary rotation entry points for Infisical bootstrap
  credentials, and their exact semantics are only stable once the adoption/bootstrap path finishes

## Risks

**Rotating a credential while a worker holds it.** Workers receive credentials as in-memory state
at step-dispatch time. The control plane service and workers receive Infisical Universal Auth
credentials as file-mounted secrets at startup. Rotating a file-mounted credential while a worker
is mid-execution will not disrupt the current step (the worker already has the value in memory),
but any subsequent step that calls `enterStep(...)` to re-acquire will use whatever is in the
mounted file at that moment. If the file is replaced before the step calls acquire, the new value
is used; if the old credential has been revoked at the Infisical server by that point, the acquire
fails. The rotation runbook must specify a safe sequencing: issue new credential, update mounted
file, confirm new credential resolves, then revoke the old one at the issuer — not simultaneously.

**Admitted version references and Infisical version history.** Rotation in Infisical creates a new
secret version. The admitted reference records the version at admission time. A retry or rollback
of a run admitted before the rotation will try to fetch the old version. Infisical retains prior
versions unless explicitly deleted. Operators must not delete older Infisical versions until all
retry and rollback retention windows for runs admitted against those versions have elapsed. This
window is not currently defined; this task must establish it.

**Bootstrap credential rotation is per-machine and non-recoverable.** Infisical Universal Auth
client secrets are shown only once at creation. If the old client secret is revoked before the new
one is persisted locally, the machine loses its bootstrap credential and must re-run
`i --rotate-bootstrap-credentials --force-overwrite-local-credentials` to create a new one. Any
deployment runs that relied on the now-revoked credential in an in-flight protected/shared worker
will fail.

**Control plane bearer token rotation has no graceful handoff.** The `VBR_DEPLOY_CONTROL_PLANE_TOKEN`
is a static bearer token checked at the control plane's startup boundary and on every inbound
submission. There is no dual-token grace period mechanism today. Rotating it requires a coordinated
restart of the control plane service with the new value before the old token is revoked, and any
clients holding the old token (Jenkins pipelines, CLI sessions) must be updated simultaneously.

**Keycloak `deployment-runner` client secret rotation breaks Jenkins bindings.** The Jenkins
pipeline uses the client secret stored as a Jenkins credential. Rotating it requires updating both
Keycloak and every Jenkins credential binding that references it. The deploy CLI flag
`--deployment-client-secret-env` reads the secret from a named environment variable; rotating the
Keycloak secret while a Jenkins job is mid-execution will cause the next `infisical secrets set` or equivalent auth call
to fail.

## Trade-offs

**No automated rotation scheduler.** Implementing a cron-driven rotation mechanism would require
a reliable external scheduler and the ability to update mounted credential files on running
containers without a restart. The reviewed approach is operator-initiated rotation with a
documented periodic review obligation. Automated rotation is deferred; the policy establishes the
trigger conditions under which operators must rotate manually.

**No secret-version retention policy enforcement in tooling.** The tooling does not currently
enforce a minimum version retention window. This task documents the policy (do not delete Infisical
secret versions until retry/rollback retention windows expire) but does not add a guardrail in code.
Adding a code-level guardrail would require the rotation tooling to query the control plane for the
oldest admitted version in use, which is a new API surface.

**Infisical rotation remains a manual `infisical secrets set` step.** The existing Infisical rotation runbook
(write new KV version, verify, regenerate fixture) is correct but requires direct Infisical CLI access.
This task documents but does not automate it. A `deploy admin infisical rotate-secret` command is
out of scope here.

**The `refreshMode: "none"` invariant limits zero-downtime rotation.** Because ordinary static
secrets use `refreshMode: "none"`, a running worker that has already admitted a specific version
will not pick up a new version mid-execution. This is safe from a disruption standpoint but means
the new credential value does not take effect for that run; only fresh admissions (new deploys,
promotions) will pick up the rotated value. Operators should verify at least one successful new
admission before revoking the old credential version.

## Considerations

- The `sprinkleref --check` gate runs before every deployment and validates resolver config. After
  rotating a bootstrap credential and updating the local resolver profile, `sprinkleref --check`
  should be run to confirm the new credential resolves correctly before triggering a deployment.
- The `deploy auth doctor --deployment <label>` command reports credential-source selection and
  missing setup without touching secret values. It is the correct first diagnostic step after a
  rotation to confirm the runtime will use the new credential source on the next deploy.
- The `deploy admin infisical check --deployment <label>` command calls Infisical with
  `viewSecretValue=false` and can confirm that the new Infisical secret version is visible before
  a live deployment run uses it.
- The `i --rotate-bootstrap-credentials --force-overwrite-local-credentials` path in
  `infisical-bootstrap.ts` issues a new Infisical client-secret record and overwrites the local
  sink (macOS Keychain or local file). It does not revoke the old record; that must be done
  manually in the Infisical console. The rotation runbook must include this explicit step.
- The `machine-label` flag on bootstrap commands writes a human-readable label on the Infisical
  client-secret record. A decommission runbook should instruct operators to find the record by
  machine label and revoke it, not by client ID, since the client ID is not visible in the label
  field. If a machine was bootstrapped without `--machine-label`, operators must identify the
  correct record by creation time or description field.
- `credentialClass: "break_glass"` is defined in the fixture type and referenced in the
  observability and authz layers. Break-glass credentials must never participate in routine rotation
  cycles; their lifecycle is governed by incident review. The rotation policy should explicitly
  exclude them from the periodic rotation schedule and reserve them for post-incident revocation
  only.
- The `numUsesLimit: 0` default for Infisical client secrets (no usage cap) and
  `accessTokenNumUsesLimit: 0` for access tokens means credential lifecycle is entirely
  TTL-driven. This is the reviewed default; any deployment that needs usage-capped credentials
  must override `--access-token-ttl` and `--client-secret-ttl` at bootstrap time and document the
  override in the deployment's reviewed metadata.
- The `infisical-bootstrap.md` troubleshooting section already documents the stale-credentials
  recovery path. The rotation policy should cross-reference it rather than duplicating it.
