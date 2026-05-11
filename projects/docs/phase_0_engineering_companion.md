# Phase 0 Engineering Companion

**Date:** April 27, 2026
**Companion to:** `phase_0_architecture.md`
**Purpose:** Working engineering artifact — pilot-readiness gates, coding discipline, and what to listen for during design-partner conversations.

This document is intentionally short. The architecture document is the source of truth for design decisions; this document is what the team uses week-to-week.

---

## 1. Pilot-readiness gates

The architecture is implementable starting day one. **No design partner connects to the direct-upload MCP experience until Gates 1–4 have passed against real systems**, not mocks. **No design partner sees connector flows until Gate 5 has also passed.** Each gate has explicit pass criteria. The split is deliberate: a direct-upload demo can ship before connector readiness if Gate 5 slips.

These are distinct from "implementation done." Implementation can complete in week 6. The first real customer doesn't connect their agent until every box below is checked.

### Gate 1: Ragie ACL filter behavior validated

Ragie's public docs currently state that `$in` over list-of-string metadata has any-overlap semantics, which is what the ACL model needs:

```
acl_scope_ids = ["A", "B"], filter $in: ["B", "C"] → match
```

**Pass criteria:**

- [ ] Real Ragie call confirms documented any-overlap behavior on a test partition
- [ ] If any-overlap fails: boolean-per-scope encoding implemented end-to-end (metadata builder, filter constructor, citation mappings, post-Ragie validation)
- [ ] Continuous regression test in tenant-leak suite

This is the **week 1 spike**. Do not start week-2 work until this is settled. See `phase_0_architecture.md` §8.3.

### Gate 2: Full tenant-leak suite passes against real Ragie

The leak suite in §11.2 of the architecture must run end-to-end against a live Ragie partition, not mocked retrieval.

**Pass criteria:**

- [ ] Every test in §11.2 passes against real Ragie
- [ ] Suite is wired into CI; failure blocks deploy
- [ ] Seed fixtures cover the three-context demo (admin, Investor A, Investor B)
- [ ] High-stakes cases verified manually: cross-tenant retrieval, view expiry, approval ≠ `fetch_full_document`, expired/revoked/wrong-token grants, tenant in `deletion_pending`

### Gate 3: WorkOS MCP Auth tested against real clients

OAuth, consent, dynamic tools/list, token refresh, and revocation must be validated against the agent clients we expect design partners to use.

**Pass criteria:**

- [ ] Claude (Desktop or web) end-to-end: connect, consent, retrieve tools, call `search_documents`, observe results
- [ ] ChatGPT end-to-end: same flow
- [ ] Cursor or another MCP client end-to-end: same flow
- [ ] Each client tested for: tools/list visibility filtering (5 vs 6 tools), token refresh, revocation invalidating in-flight calls
- [ ] Branded redirect handler behavior recorded for each client (some follow opaquely; some surface URL; some follow more than once)

### Gate 4: `fetch_full_document` end-to-end

The full grant lifecycle must work, including all failure cases.

**Pass criteria:**

- [ ] Happy path: tool call → grant → branded URL → click → 60s signed URL → file delivered → audit
- [ ] Bad token: 403
- [ ] Expired grant: 410
- [ ] Revoked grant: 403
- [ ] Missing tool scope (`documents:read_full_source`): denied at tool invocation; tool absent from `tools/list`
- [ ] Disabled tenant policy: denied
- [ ] Disabled vault policy: denied
- [ ] Disabled view policy: denied
- [ ] Expired view: denied
- [ ] Tenant in `deletion_pending`: denied
- [ ] Rate limits trigger correctly at all three dimensions
- [ ] Audit row written for every issuance and every click; `first_used_at`, `last_used_at`, `access_count` updated correctly
- [ ] **No external agent has `documents:read_full_source` granted until this gate passes**

### Gate 5: External-source demo readiness

The connector add-back (architecture §8.8) is in scope for Phase 0 but is explicitly throwaway. GitHub repository ingestion (architecture §8.9) is also in scope for Phase 0 and is implemented first-party because Ragie's public connector API does not expose GitHub/git. This gate has both a **before-implementation** sub-gate and **before-external-demo** sub-gates. The architecture document and the connector/source review both treat these as hard gates, not nice-to-haves.

**Before implementation starts:**

- [ ] **Replacement epic created in the team's planning tool** with the six trigger conditions from architecture §8.8.6 as completion criteria: first paying customer contracted; design-partner ask for `fetch_full_document` on Connect-sourced documents; design-partner ask for source-system permission mapping; design-partner ask for continuous source-update sync; design-partner ask for the platform — not Ragie — to hold source OAuth credentials; or three months from start of Phase 0 implementation. Whichever fires first ends the throwaway period. The epic's existence is what makes the replacement obligation visible to the team week-to-week, not just in the architecture document.

**Before any external design partner sees connector flows (week 4–6):**

- [ ] **Connect metadata-shape validation passes** (architecture §16, risk #3): real Connect ingestion produces documents with `tenant_id`, `vault_id`, `internal_document_id`, `acl_scope_ids`, `status`, `source_external_system`, `source_external_ref` correctly populated; metadata overlays on connection-managed documents survive future syncs; and webhook payloads expose enough per-document or per-sync information to reconcile updates. If Connect doesn't support the full metadata model, the affected connector is removed from the external demo or replaced with our own source-specific connector before any connector demo.
- [ ] **Connect OAuth flows work end-to-end for Drive, Notion, and Slack** (architecture §16, risk #4). Each source authorized, ingested, and visible in the review queue. GitHub is not part of Ragie Connect for Phase 0; it has the separate first-party source gate below.
- [ ] **Source-update behavior validated** (architecture §8.8.3.1, §16 risk #6): an upstream change to a previously-published Connect-sourced document (a Drive edit, a Notion update, a Slack message/file update, etc.) is provably unable to expose updated content through MCP retrieval before founder review. **This means validating both race windows.** Window B (in-handler, between `documents.status` update and Ragie metadata patch) is closed by the database-before-metadata ordering and the local fail-closed validation. Window A (pre-webhook, between Ragie's internal indexing and a usable webhook signal) is the harder one and is the central security gate for connector demos. Before any external connector demo, **one** of the following must be empirically demonstrated:
  1. Ragie does not make updated source content retrievable until after the corresponding per-document update signal has been delivered, OR
  2. Ragie can be configured so source updates are not automatically indexed into a document still marked `'published'`, OR
  3. The `connector_connections.sync_mode = 'paused_after_import'` strategy is in effect for the demo connection: continuous sync is disabled in Ragie after first import, the founder initiates refresh through an explicit console action, the refresh enables the connection, schedules a sync, ingests changes as `'review_pending_update'`, and disables the connection again on completion, OR
  4. A versioned-metadata strategy guarantees retrieval matches only the most recently reviewed snapshot.

  Options 1 and 2 depend on Ragie's behavior — confirm or refute via real testing in week 4. Option 3 is the safe fallback we control unilaterally and is the Phase 0 default if 1 and 2 cannot be proven. Option 4 is the production replacement's responsibility.

  **This gate is the connector demo's primary security gate** — without it, an unreviewed source update could expose new content to investors under stale ACL scope assignments. The validation must specifically cover the pre-webhook interval, not just the in-handler ordering.

- [ ] **GitHub App source gate passes** (architecture §8.9, §16 risk #7): the founder can install the GitHub App on exactly one selected private repository; org-wide/multi-repo installs are rejected unless narrowed to one repository; `Contents: read` and `Metadata: read` are sufficient for default-branch file reads; optional `Pull requests: read` / `Issues: read` are enabled only if demo PR/issue discussions are included; no write, Actions/Workflows, Secrets, or Packages permissions are requested.
- [ ] **GitHub content hygiene validated** (architecture §8.9): generated files, vendored dependencies (`node_modules`, `vendor`, `dist`, `build`, `target`, `.cache`, `.next`, `out`), lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`), binary assets, minified files, source maps, `.env`-style files, large files, and files matching known secret patterns are excluded before Storage or Ragie ingestion. Code files default to `scope_founder_only`; investor-visible scope requires explicit founder selection in the review queue.
- [ ] **GitHub snapshot semantics validated** (architecture §8.9.4): repository refresh is founder-initiated, compares the default-branch tree/blob SHAs, moves changed published documents to `review_pending_update`, and never auto-publishes updated content. Optional GitHub webhooks may only mark `refresh_available`.
- [ ] **Scoped-source enforcement** (architecture §8.8.2, §8.9): the console authorization UI accepts only one Drive folder, one selected Notion scope, one Slack channel, and one selected GitHub repository — never whole-organization or whole-workspace authorization. A test verifies that overbroad authorization is rejected where the connector/source flow gives us enough information to detect it.
- [ ] **Connect-sourced documents land with most-restrictive default ACL** (typically `scope_founder_only`) and `documents.status = 'review_pending'`. Verified by the Connect-specific tenant-leak tests in architecture §11.2.
- [ ] **Connect authorization branding compatible with "no Ragie-facing product surface"** (architecture §16, risk #5). Walk through the full authorization flow with each source. If Ragie branding is visible to the founder during the OAuth handoff, the connector demo is **internal-only** until the UX is white-labeled, embedded, or routed through our own UI. Ragie white-label/embed flow is documented as an Enterprise feature requiring Ragie setup, so this may become an external prerequisite. Document the observed behavior for each source in the team's runbook.
- [ ] **Slack scope confirmed** (architecture §8.8.2): if Slack is in the demo, it is constrained to a single explicitly-selected channel, read-only historical sync, no private-channel auto-discovery. Also account for Ragie's documented Slack app review warning and workspace approval requirements. If Slack costs material schedule time, drop it — Drive and Notion are sufficient to prove the Connect story.
- [ ] **Notion connector limitation confirmed** (architecture §8.8.2): Ragie's documented one-connector-per-account-per-workspace and shared workspace-token behavior is acceptable for the selected demo tenant, or Notion is internal-only until the production connector replacement.
- [ ] **GitHub retrieval bakeoff passes** (architecture §8.9.5, §16 risk #8): one repository, default branch only, prose content (READMEs, ADRs, design docs, optional PRs/issues) plus selected code files indexed by Ragie as text (no commit history). A 10-15 query bakeoff confirms investor-visible results come primarily from README/ADR/docs/prose unless code has been explicitly promoted.
- [ ] **`fetch_full_document` is denied for Connect-sourced documents** under all combinations of tool scope, tenant policy, vault policy, and view policy. This is the most important Connect-related security test. The denial holds regardless of `documents:read_full_source`, regardless of any tenant/vault/view full-fetch policy enablement, and regardless of ACL scope assignment. Direct uploads support full-file fetch on the same documents only if the founder has separately uploaded a copy.
- [ ] **`fetch_full_document` is denied for GitHub-sourced documents** under all combinations of tool scope, tenant policy, vault policy, and view policy, even though sanitized GitHub snapshots are mirrored to Supabase Storage. Direct uploads support full-file fetch on the same engineering document only if the founder has separately uploaded a copy.

This gate is independent of Gates 1–4. A connector demo is allowed to ship later than the direct-upload demo if any of these sub-gates is still in progress.

---

## 2. Coding discipline

Non-negotiable engineering norms. These preserve the architecture's load-bearing properties through the codebase.

### 2.1 Naming preserves the tool-scope vs ACL-scope distinction

The architecture distinguishes:

- **Tool scopes** (e.g., `documents:search`) — capability grants on `agent_connections.granted_scopes`
- **ACL scopes** (e.g., `scope_investor_a`) — content-tag grants from `authz_scopes` and `user_scope_grants`

Variable and parameter names must reflect this. Use:

- `toolScopes` (never just `scopes` for tool capabilities)
- `aclScopeIds` (never just `scopes` for ACL tags)
- `allowedViewIds` (always plural; matches schema)
- `effectiveAclScopeIds` (the resolved intersection, never just `effectiveScopes`)
- `grantedToolScopes` (when copying from `agent_connections.granted_scopes`)

A function parameter or variable simply named `scopes` should fail code review.

### 2.2 Authorization tests live separately from tool tests

Three test suites, three concerns:

- `data-room-authz` package tests — `resolveRetrievalConstraints` and `resolveSourceAccess` exercised directly with every input combination, no MCP layer
- `data-room-mcp-tools` package tests — each tool exercised via its handler, asserting it calls `data-room-authz` and produces the expected externally-observable behavior
- `platform-source-access` package tests — Source Access Service exercised directly: grant lifecycle, HMAC verification, branded URL handler, expiry, revocation, one-time

The integration test that proves "MCP tools, console previews, and console source delivery all go through the same authorization path" is its own test, separate from any individual tool's test. If you can't write it, the boundary has been violated.

### 2.3 Honor the redirect language as written

The architecture says (§7.2):

> The MCP response never includes a raw Supabase or Ragie URL. The branded URL handler may redirect the HTTP client to a short-lived Supabase signed URL. Some clients may expose that final redirected URL.

In code comments, customer-facing docs, and security documentation, use this phrasing. Do not say "the client never sees a Supabase URL." That claim is false with the current redirect implementation; making it creates a credibility problem during security reviews.

If a customer requirement appears that demands the client never see the downstream URL, that's the trigger to ship the streaming proxy (architecture §19).

### 2.4 IP/UA fields are forensics-only

`source_access_grants.last_access_ip` and `last_access_user_agent`:

- Never returned in any MCP tool response shape
- Never returned to console UI for non-admin roles
- Never logged outside `source_access_grants` and `audit_events`
- Retention: 90 days after grant expiry, then nulled (Phase 1 hardening: truncate or hash)
- Documented in the privacy/security documentation given to design partners

A test should assert that no MCP tool response shape contains either field.

### 2.5 Two dependency boundaries, both enforced in CI

Architecture §17.1 introduces a pragmatic split between `projects/libs/platform-*` and `projects/libs/data-room-*` packages. Architecture §17.2 keeps the existing data-flow boundary on the MCP tool layer. Both are enforced in CI from day one.

**Boundary 1 — platform must not depend on data-room or on any app.** Nothing under `projects/libs/platform-*` may import from `projects/libs/data-room-*` or from `projects/apps/`. The reverse is allowed: data-room libraries import platform libraries directly, no abstract interfaces, no plugin registries. Apps compose libraries from both layers but do not import other apps. The full rule set is in architecture §17.1.

The line is naming-and-concept-based, not speculative. A concept lives in `platform-*` if its definition makes sense without knowing what a "vault" is (`Tenant`, `AgentConnection`, source-access grants, audit events, jobs, rate limits, the Ragie wrapper). A concept lives in `data-room-*` if its definition fundamentally references vault/section/view/document (`Vault`, `Section`, `View`, the MCP tool catalog with `list_vaults`/`search_documents`, the review queue, ACL scopes named for investors and founders).

This is not a multi-app framework. There are no `app_templates`, recipes, or plugin systems — just a one-way import rule. If a future second app is funded, that's an architecture conversation; the split today exists purely to keep app-specific code out of platform-named packages.

**Boundary 2 — `data-room-mcp-tools` may only reach the policy/source/audit/rate-limit/ragie surface.** It may import: `data-room-authz`, `platform-source-access`, `platform-ragie` (wrapped, never `platform-ragie/connect/`), `platform-audit`, `platform-rate-limit`, `data-room-domain`, `platform-domain`. It may not import: raw Supabase clients, raw Ragie SDK, raw Storage clients, `platform-db` or `data-room-db` directly, `platform-auth-workos` directly, or `data-room-ingestion`.

Both boundaries are enforced via lint rules (`eslint-plugin-boundaries` or equivalent) plus a Buck dependency-graph test, not by code review judgment. The same MCP-layer discipline applies to console REST handlers and worker job handlers — they go through `data-room-authz` and `platform-source-access`, not around them.

### 2.6 The Connect throwaway is structurally isolated and visibly tagged

Connect-related code is the highest-risk part of Phase 0 to leave in production by accident. These rules make accidental survival structurally harder:

- **All Connect-touching files live in `projects/libs/platform-ragie/connect/`** — not scattered across the codebase. A grep for `connect_drive` or `source_external_system` outside that directory should turn up only the schema definition (in `data-room-db` for `connector_connections` and `documents.source_external_system`) and the post-Ragie validation code, not business logic.
- **`platform-ragie/connect/` exposes generic ingestion primitives only.** It provides "ingest a file with metadata" and webhook handlers; it does not import `Vault`, `Document`, or any data-room type. Data-room-specific behavior (review-pending status, default ACL scopes, review-queue registration) lives in `data-room-ingestion` and is wired in `apps/data-room-worker`.
- **Every Connect-touching file has a top-of-file tag**: `// PHASE 0 THROWAWAY — replace before first paying customer; see arch §8.8.6`. This is a comment, not a structural enforcement, but it ensures that anyone reading the code in week 12 knows what they're looking at.
- **`resolveReviewPreview` (architecture §6.9) is unreachable from `data-room-mcp-tools`.** The dependency-boundary lint forbids it. A runtime test additionally asserts that no MCP tool handler can call it — even by reflection or string-based dispatch.
- **The console review queue uses `resolveReviewPreview`, never direct Ragie Retrieval calls.** A code-review check (or a test that scans the console package for direct Ragie SDK imports) prevents the review queue from accidentally bypassing the dedicated authorization path.
- **The replacement epic exists in the team's planning tool from day 0.** Closing it requires a reviewed and shipped production replacement design — not just deletion of the throwaway code. This is what the architecture document means when it says the obligation is "not optional."

A test asserts the structural boundary explicitly: every public symbol exported from `projects/libs/platform-ragie/connect/` is referenced only from `projects/apps/data-room-worker/` (Connect ingestion wiring through `data-room-ingestion`) and the Connect-specific test fixtures. If anything in `data-room-mcp-tools` ever imports from `platform-ragie/connect/`, CI fails. If anything in `platform-ragie/connect/` ever imports from any `data-room-*` package or any `apps/` directory, CI fails (this falls out of Boundary 1 above).

### 2.7 Build and deploy go through the repo, not around it

Architecture §17 specifies that builds use Buck/Nix and that protected/shared deployments consume admitted immutable artifacts through the repo `deploy` front door. This has a few day-to-day consequences engineers should internalize:

- **Every deployable artifact has a Buck target.** If you need to run something in dev/staging/prod, it has a target under `projects/apps/<app>` and a deployment under `projects/deployments/`. There is no "I just `vercel deploy`'d it from my laptop" path for protected/shared targets.
- **Vercel git auto-build is not the production path.** The Vercel publisher accepts prebuilt `.vercel/output` artifacts produced by Buck; admission happens before publish; the deployment record carries Vercel deployment ID, URL, and source revision. Local `vercel dev` is fine for inner-loop work; protected/shared deploys use the prebuilt path.
- **Secrets through `SprinkleRef`/Vault, never in TARGETS or `.env`.** Every secret has a stable contract ID (e.g., `secret://deployments/platform/source_grant_hmac_secret`). Step-specific requirements (`publish`, `provision`, `smoke`) keep audit clear. Local fixtures are explicit non-production overrides.
- **OpenTofu through deployment-owned `opentofu-stack` provisioners, not a separate `infra/` tree.** Vercel project/domain/env wiring lives with `data-room-console-{env}/`. Container-runtime service wiring lives with `data-room-{web,worker}-{env}/`. Shared infrastructure (DNS, Supabase project, secret path scaffolding) lives in `platform-foundation-{env}/` as provisioner-only deployments.
- **Releases are coordinated, not atomic.** Worker → web → console for adding capabilities; reverse for removing them; schema migrations precede the readers. For risky changes, use feature flags or compatibility windows rather than assuming a cross-provider transaction. See architecture §17.4.
- **Local development uses framework-native commands.** `next dev` for the console, `tsx watch` (or equivalent) for `data-room-web` against a local Supabase, the Supabase CLI for local Postgres + Storage. The build/deployment machinery does not gate the inner loop; it gates what reaches design partners.

### 2.8 Tests that protect invariants must fail when violations are introduced

The architecture has three structural invariants whose tests are easy to write in a way that gives a false sense of safety:

1. **The platform/data-room dependency boundary** (architecture §17.1). The lint rule and Buck dependency-graph test pass today because no platform package imports from data-room — but they would also pass if the rules were misconfigured and silently allowed everything. A test that "passes because nothing was wrong" gives less confidence than one that "fails when something is deliberately wrong, then passes when the violation is removed."
2. **The agent atomic-write invariant** (architecture §9.2, §11.2). Both rows must exist; absence of the bounds row must deny. The leak-suite tests are easy to skip when "this state shouldn't happen" — but the invariant only protects anything if the test runs on every code change that could introduce the inconsistency.
3. **The Connect throwaway containment** (companion §2.6). The CI rule that nothing in `data-room-mcp-tools` imports from `platform-ragie/connect/` is structural, but it only protects the demo if it actually runs on every PR.

For each of these, the test discipline is the same:

- **Write a deliberate-violation fixture as part of the test setup.** For the dependency-boundary lint, include a fixture file that _would_ violate the rule, run the lint against it, and assert the lint fails. Then remove the fixture and assert the lint passes against the real codebase. The test verifies both directions: false negatives (the rule actually fires) and false positives (the rule doesn't fire on legitimate code).
- **Run the test on every PR, not just on PRs to the relevant package.** A PR to `apps/data-room-web` can introduce an atomic-write violation just as easily as a PR to `platform-db`. The leak suite runs on the whole codebase, every time.
- **Write the invariant-protecting test before the code it protects.** For the agent atomic-write invariant, the test that asserts "no `agent_connections` row exists without a corresponding bounds row" is the _first_ test written, before the connection-creation code. This is the discipline that makes the invariant protect anything; otherwise the test becomes a backstop on code that's already been written and reasoned about, which catches less.

A separate concern, same theme: **run the leak suite against a realistic-volume test database, at least once per implementation phase.** RLS failure modes around service-role usage, complex joins, and concurrent query patterns can pass on twenty seeded rows and fail on twenty thousand. Week 4 of the implementation should include at least one leak-suite run against a realistic-scale dataset, not just the fixture-sized one used for the per-PR run.

A test that "passes because nothing has gone wrong yet" is not a test. A test that fails when a deliberate violation is introduced and passes when the violation is removed is a test that's actually doing work.

---

## 3. Promotion-trigger watchlist

The architecture defers many capabilities to Phase 1+. Each has a documented trigger. This watchlist splits them by signal source so the team knows what to actively listen for vs. what to wait on.

> **Hard deadline (not a watchlist item).** The production-grade replacement for the Ragie Connect throwaway implementation must ship before the earliest of: first paying customer; design-partner ask for `fetch_full_document` on Connect-sourced documents; design-partner ask for source-system permission mapping; design-partner ask for continuous source-update sync; design-partner ask for the platform — not Ragie — to hold source OAuth credentials; or three months from start of Phase 0 implementation. Whichever fires first ends the throwaway period. Tracked as the planning epic created under §1 Gate 5 — not as a watchlist signal.

### 3.1 Actively listen for in design-partner conversations

When you hear these signals, write them down and count them. The trigger fires when the threshold is met. Ideally the team has a shared running tally — a Notion page, a Slack channel, anything visible.

| Capability                                                         | Signal                                                                                                   | Threshold                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FAQ workflow                                                       | "Can my agent help me draft/maintain a FAQ for investors?"                                               | 3+ founders                                                                                                                                                                                                                                                                                                                             |
| Additional Connect-supported sources beyond Drive / Notion / Slack | "Can you also pull from Confluence / Salesforce / etc.?"                                                 | 1 ask is enough if Connect supports it natively, so the marginal cost per source is small. Subject to schedule capacity, support confirmation, and the throwaway-period deadline above. GitHub is already a Phase 0 must-have through the first-party importer, not a watchlist item.                                                   |
| Custom connectors for sources Ragie Connect doesn't support        | "Can you pull from [our custom internal system]?"                                                        | 2+ design partners ask for the _same_ unsupported source. This is a different beast: a custom worker, not a Connect throwaway extension.                                                                                                                                                                                                |
| Connect-sourced `fetch_full_document`                              | "I need to download the full Drive file the agent cited, not just snippets"                              | 1 ask. **Triggers the production replacement immediately**, not just a feature add — full-file delivery for Connect-sourced docs is one of the six conditions that ends the throwaway period (architecture §8.8.6). Until then, founders who need a particular Connect-sourced document downloadable upload a copy directly.            |
| Connect-sourced continuous source-update sync                      | "When I update a Drive doc, the agent should see the new version automatically"                          | 1 ask. **Triggers the production replacement immediately**, not just a feature add — Phase 0 uses snapshot-import semantics (architecture §8.8.3.1) where source updates after publish move documents to `'review_pending_update'` and require founder review; continuous sync is one of the conditions that ends the throwaway period. |
| Email ingestion                                                    | "I want to forward documents to a vault email address"                                                   | 1 design partner asks, with sensitive-doc transport caveats discussed and accepted                                                                                                                                                                                                                                                      |
| Streaming download proxy                                           | "I need mid-TTL revocation" / "I need byte-level audit" / "the client must never see the downstream URL" | 1 high-sensitivity customer                                                                                                                                                                                                                                                                                                             |
| One-time grants by default                                         | "Each link should only work once"                                                                        | 1 high-sensitivity customer (after behavior validated across target agent clients)                                                                                                                                                                                                                                                      |
| Source-preview URLs from `fetch_source`                            | "Citation passages are clunky inline; can we get a preview link?"                                        | 1 customer with a clear use case (long passages, image-heavy citations)                                                                                                                                                                                                                                                                 |
| Entity extraction                                                  | "I want structured fields like contract dates, parties, renewal terms"                                   | 1 customer with a clear use case                                                                                                                                                                                                                                                                                                        |
| Subtractive view inheritance                                       | "I want this investor view to be the base minus specific sections"                                       | 1 customer                                                                                                                                                                                                                                                                                                                              |
| Multi-level base-view chains                                       | "I want overlay-of-overlay views"                                                                        | 1 customer                                                                                                                                                                                                                                                                                                                              |

### 3.2 Wait for internal/operational signals

These won't come from design-partner conversations. They come from engineering observation, audit signals, or operational issues.

| Capability                        | Trigger                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkOS FGA                        | Local ACL logic in `authz/` package becomes hard to explain, test, or audit                                                                                      |
| Per-vault Ragie partitions        | Retrieval quality measurement shows cross-vault keyword stats hurt; or tenant page/partition limits become awkward; or deletion/reindex by vault becomes painful |
| Eval automation (LangSmith/Ragas) | Manual golden-query tests miss a retrieval regression that lands in production                                                                                   |
| Per-document rate limits          | Audit signals show repeated single-document fetch patterns suggesting exfiltration probing                                                                       |
| Spacelift                         | Infra change volume or audit needs justify managed IaC execution                                                                                                 |
| HMAC secret rotation              | Phase 1 hardening cadence or compromise event                                                                                                                    |
| Separate worker microservice      | Worker process needs its own scaling profile or runtime                                                                                                          |
| Provider abstraction layer        | Active Ragie alternative under evaluation, or contractual portability requirement                                                                                |

### 3.3 Triggered by business or compliance events

| Capability                    | Trigger                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| Enterprise SSO + SCIM         | First enterprise prospect requires it for contract                        |
| Multi-region / data residency | First EU contract                                                         |
| Multi-app abstraction         | Second app type is funded                                                 |
| Native chat UI                | Customer feedback indicates BYO-agent has prohibitive onboarding friction |

---

## 4. Week-1 definition of done

Concrete, measurable. Each item is "done" or "not yet" — no half-credit.

**Schema and authorization foundation:**

- [ ] All 23 tables migrated with composite tenant-aware FKs (architecture §9), split between `platform-db/migrations/` (platform-owned tables: tenants, tenant_policies, agent_clients, agent_connections, authz_scopes, user_scope_grants, source_access_grants, audit_events, retrieval_events, ragie_documents, ragie_citation_mappings, ragie_webhook_events, platform_jobs) and `data-room-db/migrations/` (data-room-owned tables: vaults, vault_sections, documents, document_acl_scopes, data_room_views, data_room_view_scopes, access_requests, connector_connections, github_repository_connections, data_room_agent_connection_bounds)
- [ ] Migration runner produces a single deterministic ordered bundle from both packages; applied to a target Supabase project; RLS test suite passes
- [ ] RLS policies on every tenant-scoped table
- [ ] `platform-domain`, `platform-db`, `data-room-domain`, `data-room-db` packages set up under `projects/libs/` with Buck targets
- [ ] **Agent-bounds atomic-write invariant encoded.** The MCP-auth flow opens a transaction in `apps/data-room-web` and inserts `agent_connections` (via `platform-db`) and `data_room_agent_connection_bounds` (via `data-room-db`) atomically. A leak-suite test asserts that no `agent_connections` row exists in any production tenant without a corresponding bounds row.
- [ ] **Agent-bounds fail-closed read encoded.** `resolveRetrievalConstraints` returns `AuthzDenied` when no bounds row exists for the connection; never an empty/permissive default. A leak-suite test inserts an inconsistent state (connection without bounds) and verifies retrieval fails closed.
- [ ] Ragie array-filter spike completed; result documented; if any-overlap fails, the boolean-per-scope decision is made and the metadata path updated

**Build and deployment rails (architecture §17):**

- [ ] Buck/Nix toolchain configured; `data-room-console`, `data-room-web`, `data-room-worker` each have a Buck target that produces a deployable artifact
- [ ] Deployment metadata skeletons exist under `projects/deployments/` for `platform-shared`, `platform-foundation-dev`, `data-room-console-dev`, `data-room-web-dev`, `data-room-worker-dev`
- [ ] `secret_requirements` declared for every Phase 0 secret with stable `SprinkleRef` contract IDs (Vercel API token, Supabase service-role key, WorkOS keys, Ragie API key, `source_grant_secret`, OpenTofu state credentials); Vault is wired as the production backend
- [ ] `opentofu-stack` provisioner working for `platform-foundation-dev` (DNS, Supabase project, secret path scaffolding, OpenTofu state)
- [ ] Vercel publisher accepts a prebuilt `.vercel/output` artifact built by Buck; smoke check returns HTTP 200; no Vercel git auto-build is configured for protected/shared targets
- [ ] Container runtime publisher wires `data-room-web-dev` and `data-room-worker-dev`; web and worker run from the same image with different entry points (or separate artifacts from the same source packages)

**CI checks:**

- [ ] CI runs migrations, RLS tests, the dependency-boundary lint, and the tenant-leak suite on every PR (companion §2.8)
- [ ] **CI enforces that nothing in `projects/libs/platform-*` imports from `projects/libs/data-room-*` or from `projects/apps/`** (architecture §17.1, the platform/data-room boundary applied to libraries and apps uniformly)
- [ ] **CI enforces that no app target imports from another app target** (architecture §17.1; apps compose libraries, not each other)
- [ ] CI enforces that nothing in `data-room-mcp-tools` imports from `platform-ragie/connect/` (Connect throwaway containment, §2.6)
- [ ] CI enforces that nothing outside console handlers imports `resolveReviewPreview` (review-queue containment, architecture §6.9)
- [ ] **Deliberate-violation tests written for each boundary rule.** For each of the boundary rules above, a test fixture introduces a violation, asserts the rule fires, and then verifies the rule does not fire on the legitimate codebase. Tests that pass because nothing was wrong give less confidence than tests that fail when something is deliberately wrong (companion §2.8).

**Operational obligations:**

- [ ] **Replacement epic created in the team's planning tool** with the six trigger conditions from architecture §8.8.6 as completion criteria (§1 Gate 5, before-implementation sub-gate)
- [ ] Repository onboarding doc points new engineers at this companion doc and at the architecture doc; documents the local-dev setup (`next dev`, `tsx watch`, Supabase CLI); names the platform/data-room boundary explicitly so new engineers know which side a new concept belongs on

If the team isn't here at end of week 1, the schedule slips into week 2 — and that's fine. Do not compress this milestone; it's the foundation everything else stands on. The build/deployment items in particular look like overhead; they're not. Establishing the rails before any code goes through them costs less than retrofitting them later.

---

## 5. What this document is not

This is not the architecture. The architecture is `phase_0_architecture.md`. This document captures the operational discipline that makes the architecture survive contact with implementation.

This is not a runbook. Specific runbooks (DR drill, customer deletion, key rotation, incident response) are separate documents written close to when they're needed.

This is not a contract with the architecture reviewer. Multiple review rounds across two reviewers converged on "ship it" — including a connector add-back round that introduced demo-readiness gates without re-opening the spec. This document is a tool for the engineering team and for whoever picks up the codebase six months from now.
