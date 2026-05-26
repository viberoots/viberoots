# 21. Control Plane MCP Surface

**Tier:** Advanced Capabilities
**Priority:** 21 of 44
**Depends on:** #4 Containerize Control Plane, #6 Supabase/WorkOS Auth Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Promote the existing read-only MCP implementation to production-ready: harden auth under #4's principal model, wire the config toggle, cover all MCP v1 tools with a no-mutation regression test, and document the endpoint for external integrations.

## What

Implement PR-6 from `docs/control-plane-plan.md`: the authenticated read-only HTTP MCP endpoint
described in `docs/control-plane-mcp.md`. The MCP server is not a separate container or separate
process. It is mounted on the same service process that already serves the API and web UI, behind
the configured `mcp.basePath` (defaulting to `/mcp`).

**V1 tools (read-only, no mutations):**

- `deployment_control_plane_status` — database, artifact-store, worker, and instance readiness.
- `deployment_queue` — recent submission summaries.
- `deployment_detail` — latest non-secret state for one `deploymentId`.
- `deployment_auth_context` — authenticated principal and non-secret grants.

**V1 resources (matching URIs):**

- `mcp://deployment-control-plane/status`
- `mcp://deployment-control-plane/queue`
- `mcp://deployment-control-plane/deployments/{deploymentId}`
- `mcp://deployment-control-plane/auth-context`

**Auth:** Production MCP requests must supply the reviewed service bearer token:

```http
Authorization: Bearer <reviewed service token>
X-Request-Id: mcp-request-123
```

Unauthenticated MCP is allowed only when the service is explicitly started in fixture/dev mode.
Setting `mcp.enabled: false` removes the endpoint entirely; callers receive the normal service 404.

**Request correlation and audit:** Every MCP request writes to `control_plane_audit_events` with
the operation, result, target deployment id when applicable, and a `requestId`. If the caller
supplies `X-Request-Id`, the service returns that value; otherwise it generates one.

**Redaction:** Response payloads are intentionally smaller than internal deployment records.
Secret-looking fields, provider tokens, Infisical credentials, artifact contents, raw environment
dumps, and unredacted errors are redacted before the MCP response is written. This uses the same
redaction helpers shared by the read API and web UI.

**Implementation status:** The core implementation is substantially complete.
`deployment-control-plane-mcp.ts` implements `handleControlPlaneMcpRoute` with auth, dispatch,
audit, and redaction. The test suite in `control-plane-mcp.test.ts` covers: tool listing, resource
listing, per-tool and per-resource authorized responses, redaction against secret-bearing fixture
records, request id correlation to audit events, disabled-mode enforcement, and fixture-only
unauthenticated mode.

## Why Now

The v1 design is complete, the implementation is largely in place, and the test suite exists.
Priority 35 reflects the ordering constraint: the MCP endpoint runs in the same service process as
the containerized control plane (#4), so the container runtime, config schema (`mcp.enabled`,
`mcp.basePath`), and file-backed credential contract must already be established before this is
promoted to production. The auth dependency on #6 matters because production MCP auth resolves
through the same service bearer-token path used by other remote clients — that path must be stable
before the MCP surface is promoted.

Task #40 (cloud-run agents) is the first downstream consumer: agents use MCP to inspect deployment
state when deciding whether to retry, promote, or escalate. Without a stable, authenticated MCP
surface, agents must scrape other APIs or use ad hoc credentials. Delivering the MCP surface before
#40 gives agents a clean, auditable, redacted read channel with no bespoke integration work.

## Risks

**Premature mutation surface.** The clearest risk is that convenience pressure causes mutation
tools to be added before the CLI and web authorization grants, idempotency keys, payload
fingerprinting, dry-run behavior, and durable audit records are verified. The plan is explicit: v1
has no mutation tools. The no-mutation regression test (`doesNotMatch(/submit|approve|run_action|
mutation/i)` against the `tools/list` response) must remain a gating test, not a comment.

**Second authorization path.** MCP must not acquire its own auth model separate from the service
bearer-token path. If it did, an agent could access deployment state through MCP with weaker
credentials than the API enforces for the same data. The implementation correctly delegates to
`requestHasReviewedBearerToken`, but any future change that adds an MCP-specific token bypass
would violate this boundary.

**Agent ambient credential access.** Future mutation-capable MCP tools must never provide ambient
provider credentials or direct Infisical/Infisical secret access to an agent. This is stated explicitly
in the design doc. The risk is that a well-intentioned mutation tool passes a resolved credential
through the MCP response to make an agent's job easier. That would export a secret through an
audited but not fully redacted channel.

**Redaction gaps.** The MCP response passes through the control-plane redactor, but the fixture
test seeds specific secret patterns (`super-secret`, `Bearer leaked`, `env-dump-secret`,
`artifact-secret`). If new secret-bearing fields are added to deployment records without
corresponding redaction coverage, MCP becomes a leak channel. The redaction tests must be
maintained alongside schema evolution.

**Fixture-mode enforcement.** The test suite verifies that unauthenticated MCP is only allowed
when `localFixture: true` is explicitly set. If that flag is ever set in a non-fixture code path,
production MCP becomes unauthenticated. This must remain a startup-time validation failure, not a
runtime fallback.

## Trade-offs

**Same process vs. separate MCP container.** The plan non-goals a separate MCP container. Running
MCP in the same service process keeps auth, redaction, read models, and audit shared without
inter-process calls. The cost is that the HTTP server must dispatch MCP requests alongside REST
API and web UI requests. This is already implemented in `handleControlPlaneMcpRoute` returning
`false` to indicate non-ownership when the path does not match, which keeps the routing composable.

**HTTP MCP vs. stdio MCP.** The design specifies HTTP MCP with bearer-token auth for production
and allows stdio only in fixture/dev mode. HTTP MCP is the correct choice for a service that must
enforce auth, write audit records, and be reachable by remote agents. Stdio MCP would require
per-process credential trust that the file-backed credential contract is explicitly designed to
avoid.

**Read-only v1 vs. mutation-capable v1.** Deferring mutations is the correct sequencing. The CLI
and web UI authorization grants, idempotency, payload fingerprinting, and dry-run behavior need
to be validated in production before an agent surface can safely trigger the same paths. Adding
mutations to v1 would skip that validation. The value of read-only MCP for agents is already
significant: status checks, queue inspection, and deployment detail are enough to drive retry and
escalation decisions without needing mutation authority.

**Stable structured responses vs. raw internal records.** MCP responses are intentionally smaller
than internal deployment records. This is a deliberate versioning and redaction boundary. The
`schemaVersion` field (`control-plane-read-deployment@1`) in the response shape signals that the
MCP surface is versioned independently of internal database schema. Keeping response shapes stable
and documented makes agent integration durable across internal schema changes.

## Considerations

- The full design is in `docs/control-plane-mcp.md`. Implementation must not extend the v1 surface
  beyond what that document specifies without updating the doc first.
- The `mcp.enabled` and `mcp.basePath` config keys are part of the control-plane container config
  schema defined in the containerization plan's PR-1 scope. The MCP handler reads these through
  `ControlPlaneMcpOptions`, which is aliased to `ControlPlaneWebOptions`, keeping config loading
  uniform across web UI and MCP surfaces.
- The NixOS container module (`deployment-control-plane-container-module.nix`) already declares
  `mcp.enabled` and `mcp.basePath` options. Verify that the nginx config emitted by the module
  (`manageNginx = true`) routes the MCP base path correctly in the module evaluation tests (PR-8
  of the containerization plan), rather than leaving it as assumed runtime behavior.
- Tests must assert: each v1 tool and resource returns the expected `tool` and `requestId` fields;
  unauthenticated calls to all tools and resources are rejected 401; `mcp.enabled = false` returns
  404 not 401; fixture-mode allows unauthenticated calls and production-mode does not; request ids
  supplied by the caller appear in both the response and the audit table; the `tools/list` response
  contains no mutation tool names; and redaction holds against fixture records containing
  secret-looking values in provider error, Infisical, artifact, and environment fields.
- Future mutation-capable MCP tools must reuse the CLI and web authorization grants, idempotency
  keys, payload fingerprinting, dry-run or plan-first behavior, and durable audit records. Any PR
  that adds a mutation tool must update `docs/control-plane-mcp.md` to document the mutation
  surface before the code lands, and must include the same redaction and idempotency test coverage
  as the existing mutation paths.
- Making viberoots public (#43) requires that the MCP endpoint fail closed for unauthenticated
  callers. The existing 401-on-unauthenticated test satisfies this, but the test must remain a
  regression gate (not be skipped or weakened) before #43 is considered safe to land.
- Operator documentation must cover: how to enable MCP via `mcp.enabled`, what auth the caller
  must supply, what the redaction guarantees are, how to use `X-Request-Id` to correlate MCP
  calls to audit events, and what fixture-mode unauthenticated MCP means and when it is safe to
  use.
