# 6. Supabase/WorkOS Auth Provider

**Tier:** Core Providers + Auth
**Priority:** 6 of 44
**Depends on:** #4 Containerize Control Plane, #5 Kubernetes / OpenTofu Deployment
**Estimated effort:** L
**Date:** 2026-05-25
**Summary:** Replace the current file-backed single bearer token with an OIDC-based identity provider (Supabase Auth or WorkOS) for human access to the control plane API, web UI, and MCP surface.

## What

Replace the current file-backed service bearer token auth (`VBR_DEPLOY_CONTROL_PLANE_TOKEN`) with a
generalized auth-provider abstraction and a concrete adapter for either Supabase Auth or WorkOS as
the application-layer identity provider.

The current auth surface has two layers that must both be addressed:

1. **Machine-to-service auth** — the control plane API currently accepts a single reviewed bearer
   token (`VBR_DEPLOY_CONTROL_PLANE_TOKEN`) for all callers: the CLI, CI (Jenkins), and any future
   web or MCP clients. This token is mounted as a file (`service.tokenFile`) in the NixOS container
   module and is validated by `requireReviewedBearerToken`.

2. **Interactive/OIDC auth** — an OIDC session flow (`POST /api/v1/auth/login` →
   `/oidc/callback`) already exists in the server and session service, and uses PKCE against an
   issuer configured via the `vault_runtime` metadata block (`VBR_VAULT_OIDC_ISSUER`,
   `VBR_VAULT_AUDIENCE`, `VBR_VAULT_HUMAN_CLIENT_ID`). The principal and grant model
   (`deployment-auth-session-principal.ts`, `deployment-auth-session-grants.ts`) is already OIDC-
   generic and maps claims to deployer/approver/admission-reporter roles from a `groups` claim.
   However, the issuer resolution is currently coupled to the Infisical runtime plan and Keycloak group
   conventions (`deployment-admin-keycloak-auth.ts`, `deployment-auth-keycloak-realm.ts`).

The task is to:

- Add a runtime auth-provider config block to the control-plane YAML schema (issuer, audience,
  JWKS URL, token type support, user-id claim, email claim, group or role claim mapping, service
  principal claim mapping, admin/deployer/admission-reporter role names, CLI login mode flag).
- Implement a Supabase Auth adapter or a WorkOS adapter (one must be selected; implementing both
  is a stretch goal) that satisfies the same OIDC discovery, PKCE exchange, token validation,
  principal extraction, and grant derivation paths used by the current Keycloak-shaped flow.
- Decouple the current issuer resolution from the Infisical runtime plan so the auth provider is a
  first-class control-plane config concern rather than a deployment-metadata concern.
- Preserve the existing OIDC session API shape (`POST /api/v1/auth/login`,
  `GET /api/v1/auth/session`, `GET /oidc/callback`) and the existing authorization model
  (submitter, approver, admission-reporter grants; project, environment-stage, and admission-domain
  scopes).
- Keep service bearer token auth as a secondary path for machine-to-machine callers (CLI, Jenkins,
  workers) where the token is still a file-backed reviewed secret, not a user-facing identity.
- Verify the same authorization model covers all three surfaces: the API, the same-origin web UI
  (session-based), and the MCP endpoint (bearer or session, same grants).
- Add audit rows with the OIDC principal identity (not just the token) for human and service
  logins.
- Add the `the auth endpoint` callback ingress path to the host/NixOS module options if
  it is not already parameterized.
- Write or update a follow-on ADR per the obligation recorded in ADR-00003: any decision on
  Supabase vs. WorkOS must be recorded before the adapter lands in production.

## Why Now

The file-backed bearer token is a single shared secret. It cannot distinguish operators, cannot
support Bob onboarding without handing Bob the same token used by the automated pipeline, and
provides no audit identity beyond the token itself. Every blocked task downstream (auth
provisioning IaC #7, Bob setup #23, making viberoots public #43) requires real user identity in
audit rows and scoped grants per operator.

The OIDC session infrastructure is already partially built: the session store, PKCE flow, callback
handler, principal extraction, and grant model all exist and are OIDC-generic. The missing piece
is the provider-config abstraction that decouples the issuer from Infisical runtime metadata and makes
Supabase or WorkOS a named, reviewed auth-provider adapter rather than an implicit Keycloak
assumption.

This task is positioned at priority 4 because multi-user access and operator onboarding cannot
start until the identity provider is real. Delaying further means every new operator access
requires sharing or rotating the single bearer token, which widens blast radius and degrades
auditability.

## Risks

- **Provider selection is not yet made.** cloud-control-design.md records Supabase Auth and WorkOS
  as candidates without a decision. Selecting the wrong provider or implementing both in parallel
  adds scope and may require revisiting IaC (#7) and operator onboarding (#23) for each.
- **Group/role claim mismatch.** The current grant model expects a `groups` claim with Keycloak-
  shaped group names (`deploy-human-{deploymentId}-submitter`, etc.). Supabase Auth and WorkOS have
  different group/role claim shapes. The adapter must normalize these without breaking the existing
  grant model or requiring each deployment to re-register groups under a new convention.
- **CLI login compatibility.** The CLI must support the provider's login flow. WorkOS may require
  a brokered flow through the control-plane service rather than a direct device or PKCE flow.
  Supabase Auth has a PKCE flow but its redirect handling may differ from the current
  `/oidc/callback` path. Either may need a provider-specific flow mode flag.
- **Admission reporter authorization.** The admission reporter grant is currently derived from
  group membership. CI (Jenkins) uses a service-principal identity, not a human login. The
  adapter must support both human and service-principal grant paths against the new provider, or
  keep service-principal grants on the existing file-backed token path.
- **Parallel operation complexity.** cloud-control-design.md recommends running the new adapter in
  parallel with the current provider if possible. The current single-token model has no parallel
  mode. Building one risks introducing a dual-auth surface with inconsistent audit identity until
  cutover completes.
- **Session and CSRF scaffolding.** The web UI session model (`POST /api/v1/web/session`, CSRF
  scaffolding) is recorded as a design requirement in the plan but may not be fully implemented
  before this task lands. Auth cutover and web UI session hardening may need to coordinate.

## Trade-offs

- **Supabase Auth vs. WorkOS.** Supabase Auth is already a candidate for the control-plane
  database and artifact store (cloud-control-design.md §Supabase Role), which makes consolidating
  on Supabase a natural fit — fewer managed vendors, shared Postgres for auth session storage.
  WorkOS offers richer organization and SSO primitives that may matter when viberoots goes public
  (#43), but adds another managed dependency with no existing Postgres or storage overlap.
  Starting with Supabase Auth is lower-friction for the current single-operator phase; WorkOS is
  the better fit once multi-organization SSO is needed.
- **Auth-provider abstraction depth.** A thin adapter that hard-codes the Supabase or WorkOS
  claim shapes is faster to implement but must be revisited if the other provider is added later.
  A fully runtime-configurable abstraction (issuer, audience, JWKS URL, claim mappings all in
  config) matches the shape described in cloud-control-design.md §Auth Provider Abstraction and
  future-proofs against a provider switch, but is heavier upfront.
- **Service token parallel path.** Keeping the file-backed bearer token active during and after
  cutover maintains CI and worker auth without disruption. However, it leaves a second auth surface
  indefinitely unless a formal deprecation gate is added. The trade-off is migration safety vs.
  long-term auth surface sprawl.
- **Keycloak group convention carry-forward.** The current group naming convention
  (`deploy-human-*`, `deploy-automation-*`, `deploy-admin-identity-*`) is Keycloak-shaped. Supabase
  and WorkOS use different primitives (roles, org memberships). Mapping the existing convention onto
  the new provider preserves all downstream grant logic but creates an impedance mismatch in the
  provider's native UI. Adopting the provider's native group/role names requires updating the grant
  derivation code and re-provisioning any existing principals.

## Considerations

- The auth-provider config block should be added to the same YAML schema introduced by the
  containerization plan's PR-1 (`instanceId`, service host/port, database URL, credential
  directory). The issuer, audience, JWKS URL, and grant claim mappings belong there, not in
  deployment metadata.
- The `humanClientId` and `issuerUrl` currently resolved from `VBR_VAULT_OIDC_ISSUER` and
  `VBR_VAULT_HUMAN_CLIENT_ID` in `deployment-vault-runtime-plan.ts` are the same values that belong
  in a runtime auth-provider config block. The auth runtime plan should stop owning them after
  this task.
- The NixOS container module (`deployment-control-plane-container-module.nix`) will need new
  options for the auth-provider config: at minimum, the OIDC issuer URL, client ID, and audience
  credential file. The `the auth endpoint` callback hostname is currently mentioned in
  cloud-control-design.md as an ingress target for the current personal server; it needs to be a first-class module
  option parameterized like `publicUrl`.
- The OIDC callback route (`GET /oidc/callback`) in the server must remain on the same ingress
  origin as the service to avoid cross-origin redirect issues unless the module exposes a separate
  auth hostname. Clarify this before committing to the ingress design.
- Audit rows must record the OIDC principal id (e.g., `oidc:user@example.com`) not just the
  session id. Review the existing audit schema to confirm the principal field is present for
  session-authenticated requests, not just bearer-token requests.
- The follow-on ADR required by ADR-00003 §Obligations must be written and accepted before the
  chosen adapter lands in a production deployment. The ADR should record: provider selected,
  integration constraints against ADR-00003, claim mapping decisions, and migration path for the
  existing Keycloak-shaped group convention.
- No browser-only authorization model and no sticky-session requirement are explicit non-goals in
  the containerization plan. The web UI session store must remain database-backed regardless of
  which provider is chosen.
- MCP endpoint auth must use the same reviewed grants. In v1, MCP is read-only, but the
  authorization check must be consistent with the API and web UI so future mutation tools do not
  introduce a second grant model.
