# 40. Explore Enabling Cloud-Run Agents

**Tier:** Advanced Capabilities
**Priority:** 40 of 44
**Depends on:** #21 Control Plane MCP Surface, #6 Supabase/WorkOS Auth Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Design the authorization model for AI agents operating over the read-only MCP surface, evaluate at least two agent frameworks, and build a narrow prototype demonstrating end-to-end audit traceability through `control_plane_audit_events`.

## What

Research and prototype cloud-run AI agents — autonomous processes that connect to the deployment
control plane via MCP, observe deployment state, and take or propose actions without requiring a
human at a terminal.

The spike has three deliverables:

1. **Framework evaluation.** Assess at least two agent frameworks (e.g., Claude Code SDK / Claude
   API with tool use, OpenAI Agents SDK, or a custom loop over MCP tool calls) for fit against the
   control plane's MCP surface, auth model, and audit requirements. Produce a short written
   comparison.

2. **Authorization design.** Define how cloud-run agents acquire and prove identity. The current
   MCP endpoint requires the reviewed service bearer token (`Authorization: Bearer <reviewed service
token>`). Agents need a separate, non-shared, revocable identity. The spike should determine
   whether service-principal grants via #6's auth-provider abstraction are sufficient, whether a
   dedicated agent identity type is needed, and how agent tokens are provisioned without a human
   login flow.

3. **Prototype.** Build one narrow working prototype that connects an agent to the control plane
   MCP surface (`deployment_control_plane_status`, `deployment_queue`, `deployment_detail`),
   performs a read-only task (e.g., summarize queue depth and flag any deployment stuck in a
   terminal error state), and produces an auditable output — one that generates a `requestId`
   traceable in `control_plane_audit_events`.

Explicit scope exclusions for the spike:

- No mutation MCP tools. The v1 MCP surface is read-only and the spike must not add or prototype
  mutation tools outside of a separate reviewed mutation-capable MCP design process.
- No ambient credential export. Agents must not receive provider tokens, Infisical credentials,
  artifact contents, or unredacted errors through MCP responses. The existing redaction layer
  already enforces this for reads; the spike must not work around it.
- No agent-only control path. The spike must not introduce a separate HTTP surface, a bypass of
  the `requireReviewedBearerToken` check, or any agent-specific auth shortcut.

## Why Now

Task #21 (Control Plane MCP Surface) delivers the read-only MCP endpoint with auth, redaction,
audit correlation, and stable versioned response shapes (`schemaVersion: control-plane-read-
deployment@1`). That surface is the prerequisite agent integration point, and this task should
not start until #21 is in production.

Task #6 (Supabase/WorkOS Auth Provider) is the prerequisite for real agent identities. Agents
cannot share the current single file-backed bearer token — that token has no per-principal audit
identity and cannot be scoped to a subset of grants. Once #6 is in place, the auth-provider
abstraction supports service-principal claim mapping, which is the natural home for a non-human
agent identity.

Cloud-run agents are the intended downstream consumer of the MCP surface. The MCP design
explicitly states that agents should use MCP to inspect deployment state when deciding whether to
retry, promote, or escalate. A spike now, while the MCP surface is fresh, keeps the agent
integration design honest: if the MCP response shapes, correlation IDs, or redaction boundaries
are awkward for real agent use, those gaps should be found before the MCP interface is treated as
stable.

## Risks

**Auth model is not designed for agent identities yet.** The current MCP surface accepts the
single reviewed service bearer token. There is no per-agent revocable credential, no scoped grant
subset for read-only agents, and no provisioning path that does not involve handing an agent the
same token used by the CLI and Jenkins. Until #6 is fully in place with service-principal grant
mapping, any prototype must use the shared token — which is acceptable for a local dev spike but
is not a production-safe agent auth model.

**Agent actions on deployment state carry mutation risk.** Even read-only agents that observe
queue state and propose actions (e.g., posting a comment, triggering a webhook, opening a PR) are
making mutations in external systems. The boundary between "read from control plane, write
elsewhere" and "read from control plane, trigger deployment action" is easy to blur. The spike
must be explicit about what the agent writes, to where, and under what authorization.

**Framework lock-in.** Selecting a specific agent framework in the spike may pull in SDK
dependencies that constrain future implementation options. The spike should remain framework-aware
but not merge framework dependencies into the main tree without a separate design review. Prototype
code should live under a clearly marked spike or experimental path.

**Audit gaps for agent-initiated reads.** The current MCP surface writes to `control_plane_audit_events`
with the MCP operation, request ID, and target deployment ID. An agent running autonomously on a
schedule or in response to a webhook will produce audit rows with the agent's service-principal
identity. If agent identity is not distinct from the shared bearer token, all agent reads appear in
the audit log as the same undifferentiated principal — making audit forensics ineffective.

**Model context and hallucination in deployment decisions.** AI agents making deployment-adjacent
decisions based on MCP tool responses may hallucinate state, misinterpret redacted fields, or act
on stale queue snapshots. The spike should treat agent outputs as advisory and human-reviewed until
a reliability baseline is established. No prototype output should be wired to a production
deployment action without an explicit human-in-the-loop gate.

## Trade-offs

**Claude Code CLI / Claude API vs. OpenAI Agents SDK vs. custom loop.** The viberoots toolchain
already uses Claude Code CLI (the current conversation context is Claude Sonnet 4.6). The Claude
API with tool use is the most natural fit because: MCP tools map directly to Claude's tool-use
JSON schema; `X-Request-Id` headers can be set per-call to propagate audit correlation; and the
response shape (`schemaVersion`, `requestId`, `tool`, `data`) is already structured for
consumption by a language model. The OpenAI Agents SDK is a reasonable alternative if multi-model
or multi-provider agent routing is desirable later. A custom loop (direct HTTP calls to the MCP
endpoint, parsed and fed to an LLM prompt) is the lowest-dependency option and the most auditable.
The spike should test at least two of these to avoid prematurely committing to one SDK.

**Polling vs. event-driven trigger.** Cloud-run agents can be triggered on a schedule (poll the
queue every N minutes), on a deployment state change event (webhook or control-plane outbound
notification), or on an explicit human invocation (e.g., a GitHub comment or CLI command). Polling
is simpler and works with the current read-only MCP surface. Event-driven triggering requires a
notification path from the control plane that does not yet exist. The spike should start with
polling and document what a future event-driven trigger would require.

**Read-only scope vs. advisory-mutation scope.** A read-only agent (observe, summarize, alert) can
be built entirely against the v1 MCP surface and adds no auth complexity beyond the agent identity
question. An advisory-mutation agent (observe, then post a PR comment, file an issue, or post a
Slack message) reads from MCP and writes to an external system — which is acceptable but requires
the agent to hold credentials for that external system, not the control plane. A direct-mutation
agent (observe, then call a future mutation MCP tool) requires mutation tools that do not yet exist
and would need the full idempotency key, payload fingerprinting, dry-run, and audit design that the
MCP docs specify for future mutation-capable tools. The spike must stay in the first or second
category.

**Agent runs as a long-lived service vs. a short-lived job.** A long-lived agent service
(persistent process, always-on) requires hosting, health monitoring, and credential rotation
management. A short-lived job (invoked by a cron, webhook, or CI trigger; runs to completion;
exits) is simpler, easier to audit, and matches the existing `control-plane worker`
model. The spike should prototype a short-lived job shape first.

## Considerations

- The MCP endpoint is documented in `docs/control-plane-mcp.md`. The spike must use the documented
  `tools/call` and `resources/read` request shapes and must not rely on undocumented or internal
  control-plane API paths. Agent integration that bypasses MCP and calls internal read APIs
  directly would lose the redaction and audit guarantees.

- Every MCP request must include `X-Request-Id` set to a value that identifies the agent run
  (e.g., `agent-queue-watch-{timestamp}-{runId}`). This is what makes agent activity traceable
  in `control_plane_audit_events`. The prototype should demonstrate end-to-end traceability: agent
  run ID in the request header, same ID in the audit table, same ID in the agent's own output log.

- The `deployment_auth_context` tool exposes the authenticated principal and non-secret grant
  summary. The spike should call this tool first in any prototype run, log the result, and assert
  the expected agent principal appears. This is the fastest way to confirm agent identity is wired
  correctly and to catch shared-token confusion before it produces misleading audit rows.

- Future mutation-capable MCP tools — when they eventually exist — must require idempotency keys,
  payload fingerprinting, dry-run behavior, and durable audit records. The spike should document
  what that mutation interface would look like for the two most likely agent use cases
  (retry a failed deployment, promote a staged deployment) so the mutation tool design can be
  reviewed before implementation, not discovered during it.

- MCP must never provide ambient provider credentials or direct Infisical/Infisical secret access to
  an agent. This constraint is stated in both `docs/control-plane-mcp.md` and
  `docs/control-plane-containerization.md`. The spike must not prototype any workaround — for
  example, an agent that calls `deployment_detail`, extracts a deployment ID, and then calls a
  separate internal API to retrieve secrets. If the agent needs information that is not in the MCP
  response, the answer is to extend the MCP surface (with redaction and audit) not to bypass it.

- The spike output document should cover: framework chosen and rationale, agent identity approach
  and any gaps remaining until #6 is complete, prototype architecture (trigger model, MCP calls
  made, external writes if any), audit trace evidence (sample `control_plane_audit_events` rows),
  open questions for a future implementation task, and a recommendation for which use case to
  implement first if the spike is successful.
