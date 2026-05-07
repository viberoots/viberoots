# Gate 1 Development Plan: Ragie ACL Filter Behavior

**Date:** April 28, 2026  
**Scope:** Implement the Phase 0 architecture through Gate 1 in `phase_0_engineering_companion.md`.  
**Gate:** Ragie ACL filter behavior validated against real Ragie.  
**References:** `phase_0_architecture.md`, `phase_0_build_deployment_companion.md`, `phase_0_engineering_companion.md`.

No older `product/specs/gate-*-plan.md` files existed when this plan was written.

Gate 1 is intentionally narrow. It does not deliver the direct-upload MCP demo. It settles the metadata encoding that every later retrieval, citation, source-access, and tenant-leak test depends on.

Gate 1 passes when:

- A real Ragie call confirms Ragie's documented any-overlap behavior for `$in` over array-valued `acl_scope_ids`, or the boolean-per-scope fallback is implemented end-to-end.
- The selected encoding is used by metadata builders, filter constructors, citation mapping assumptions, and post-Ragie validation.
- A continuous regression test exists in the tenant-leak suite.
- `phase_0_architecture.md` risk #1 is updated with the chosen result, evidence link, date, and status.

Risk-tracking rule for every PR below: if the PR validates or materially changes an item in `phase_0_architecture.md` section 16, the PR updates that risk entry in the architecture document in the same PR. Do not mark a risk as mitigated until the PR includes evidence from the relevant test or live-system validation.

---

## PR 1: Establish Gate 1 Build, Package, Secret, and Boundary Rails

### 1. Intent

Create the smallest repo structure needed to run and continuously enforce the Ragie ACL filter decision without bypassing the Phase 0 package and deployment discipline.

This PR gives later Gate 1 work a real home under the intended `projects/` layout rather than a throwaway script outside the build graph.

### 2. Scope of changes

- Add initial package directories and Buck targets for:
  - `projects/libs/platform-domain`
  - `projects/libs/platform-ragie`
  - `projects/libs/platform-test-fixtures`
  - `projects/libs/data-room-domain`
  - `projects/libs/data-room-test-fixtures`
- Add only the domain types needed for Gate 1 metadata validation: tenant IDs, vault IDs, internal document IDs, ACL scope IDs, sensitivity rank, document status, Ragie partition name, Ragie document reference, and citation mapping reference.
- Add a `platform-ragie` wrapped client surface for indexing test documents and executing retrieval with metadata filters. It may call the Ragie SDK or HTTP API internally, but callers do not import raw Ragie clients.
- Add the initial dependency-boundary lint and Buck graph checks from architecture section 17.1:
  - `platform-*` cannot import `data-room-*` or `apps/*`.
  - `data-room-*` cannot import `apps/*`.
  - app targets cannot import other app targets.
- Add the special boundary check that `data-room-mcp-tools` cannot import `platform-ragie/connect/`, even though those packages may not exist yet. The rule should be present before the directories are created.
- Add `secretspec` contract declarations for the Gate 1 live test:
  - `secret://deployments/platform/ragie_api_key`
  - environment-scoped Ragie test partition prefix or runtime config, if the repo models non-secret runtime config separately.
- Add a local-only fixture path for developer validation that is explicitly separate from production secret resolution.
- Add CI wiring for the fast parts of Gate 1: typecheck, package tests, boundary lint, and boundary-negative fixtures.

### 3. External prerequisites

- Maintainer access to CI configuration and repo build settings so new Buck/Nix, lint, and test targets can be wired into the normal PR checks.
- Agreement from the build/deployment owner on the `secretspec` contract IDs for Ragie test access; the secret value itself does not need to be provisioned until PR 3.
- Access to the repo's secret-contract or Vault administration workflow, or a designated owner who can approve the new non-production Ragie secret contract.
- Confirmation that the package names in architecture section 17 remain acceptable before the directories are created.
- No live Ragie account, Supabase project, WorkOS setup, Vercel project, or container runtime account is required for this PR.

### 4. Tests to be added by the PR

- Unit tests for metadata-domain value validation, including empty ACL scope lists, malformed IDs, and invalid status values.
- A boundary-lint positive test over the real package graph.
- A boundary-lint negative fixture that deliberately imports `data-room-domain` from `platform-ragie` and asserts the lint fails.
- A Buck dependency-graph negative fixture that proves a forbidden platform-to-data-room edge is detected.
- A secret-contract validation test that fails if the Ragie API key requirement is missing, renamed, or modeled as an ambient `.env` dependency.

### 5. Docs to be added or updated by the PR

- Update `phase_0_architecture.md` only if the package layout, target names, or secret contract IDs differ from sections 16 or 17.
- Add a short Gate 1 developer note near the new test target explaining how to run the live Ragie validation locally and in CI without exposing secret values.
- Do not mark any architecture section 16 risks mitigated in this PR. This PR creates rails; it does not validate Ragie behavior.

### 6. Acceptance criteria

- The new package and target layout matches the architecture or the architecture is updated in the same PR.
- Boundary checks fail on deliberate violations and pass on the real codebase.
- CI can run all non-secret Gate 1 checks.
- No raw Ragie client import is available outside `platform-ragie`.
- Secret requirements are declared through `secretspec`/runtime config contracts, not `.env` files or committed provider settings.

### 7. Risks related to the PR

- The repo may not yet have all Buck/Nix macros needed for TypeScript package and test targets.
- Boundary checks can give false confidence if they only pass on clean code and are never tested against a violation.
- Secret contract work can sprawl into broader deployment implementation that is not needed for Gate 1.
- Establishing package names before code exists can accidentally harden a layout that later feels awkward.

### 8. Mitigations for the risks

- Keep targets minimal and use existing repo macros where possible; add only the TypeScript target surface needed for Gate 1.
- Include deliberate-violation fixtures so boundary enforcement proves both failure and success paths.
- Limit secret work to the Ragie live-test contract and the runtime path required to resolve it.
- Treat any package-layout deviation as an architecture update in the same PR, so the spec remains the source of truth.

### 9. Consequences of not implementing this PR

- The Ragie spike is likely to land as an untracked script, which would make its result hard to preserve as a continuous regression.
- Later packages could grow around the wrong dependency direction and require churn to align with section 17.
- The team might validate the central security assumption without proving it can be rerun by CI or deployment admission.

### 10. Downsides of implementing this PR

- It front-loads build and repo-shape work before visible product behavior exists.
- It may require some target/macro cleanup once the rest of Phase 0 packages are implemented.
- It adds process overhead to a spike, although that overhead is deliberate because the spike decides a load-bearing security encoding.

---

## PR 2: Add Minimal Schema, RLS, and Tenant-Leak Harness for ACL Metadata

### 1. Intent

Create the database and fixture slice needed to evaluate ACL-scoped retrieval as a tenant-isolated behavior, not only as a Ragie API curiosity.

This PR does not implement the full Phase 0 schema. It implements the smallest durable subset that Gate 1 needs while preserving the architecture's migration ownership pattern.

### 2. Scope of changes

- Add initial migrations under package-owned locations:
  - `projects/libs/platform-db/migrations/` for `tenants`, `authz_scopes`, `agent_connections`, `ragie_documents`, `ragie_citation_mappings`, and `audit_events` if needed by the validation harness.
  - `projects/libs/data-room-db/migrations/` for `vaults`, `documents`, `document_acl_scopes`, `data_room_views`, `data_room_view_scopes`, and `data_room_agent_connection_bounds`.
- Add composite tenant-aware FKs for the Gate 1 relationships:
  - documents to vaults.
  - document ACL scopes to platform ACL scopes.
  - Ragie document references to internal documents.
  - citation mappings to internal documents.
  - agent connection bounds to agent connections and views.
- Enable RLS on the tenant-scoped tables introduced by this PR.
- Add a migration-bundle target that orders platform and data-room migrations through declared dependencies rather than filename convention.
- Add tenant-leak fixture builders for:
  - Tenant A and Tenant B.
  - Founder/admin, Investor A, Investor B.
  - Shared vault with base and investor-specific views.
  - Documents tagged with `scope_founder_only`, `scope_investor_a`, and `scope_investor_b`.
- Add the tenant-leak suite shell with the Gate 1 Ragie metadata-filter test slot. Later PRs will add the real Ragie call.
- Add audit warning event shape for post-Ragie validation drops, even if the final retrieval path is not implemented yet.

### 3. External prerequisites

- PR 1 merged, including the package rails and CI hooks that this PR extends.
- A local or disposable Postgres/Supabase-compatible test database available to the implementer and CI runner.
- Permission to create, reset, and destroy isolated test schemas or databases during automated migration/RLS tests.
- Access to whatever local Supabase tooling the repo standardizes on, if the tests rely on Supabase-specific RLS behavior rather than plain Postgres.
- No live Ragie, WorkOS, Vercel, container runtime, or production Supabase project access is required for this PR.

### 4. Tests to be added by the PR

- Migration ordering tests that fail when a cross-package migration references a table without declaring the dependency that creates it.
- RLS tests proving Tenant A cannot read Tenant B rows for every table added by this PR.
- Composite FK tests for cross-tenant document-to-vault, document-to-scope, and citation-to-document misuse.
- Fixture tests proving the three-context demo setup creates distinct effective ACL scope sets.
- A tenant-leak harness smoke test that runs without Ragie and fails closed when an agent connection has no `data_room_agent_connection_bounds` row.
- A test that verifies the Gate 1 suite includes a Ragie ACL metadata-filter regression placeholder and fails clearly when live Ragie credentials are requested but absent.

### 5. Docs to be added or updated by the PR

- Update architecture section 17.5 if the migration-bundle mechanics differ from the current Buck dependency proposal.
- Update architecture section 11.2 only if the tenant-leak suite structure changes, not to reduce the required cases.
- Update architecture section 16 risk #11 only if this PR produces evidence about Supabase RLS/service-role behavior. Otherwise leave it unmitigated.

### 6. Acceptance criteria

- The Gate 1 fixture data can be created in an isolated test database.
- RLS and composite FKs catch deliberate tenant-crossing attempts.
- The migration-bundle target produces deterministic ordering from package-owned migrations.
- The tenant-leak suite has a named Gate 1 test group ready for the live Ragie regression.
- No app, MCP, console, source-access, Connect, or GitHub source behavior is introduced in this PR.

### 7. Risks related to the PR

- The "minimal" schema may drift away from the full 23-table Phase 0 schema and create rework.
- Introducing partial authz fixtures can accidentally imply product behavior that is not implemented yet.
- RLS tests can pass with fixture-sized data while missing later service-role failure modes.
- Composite FKs across package-owned migrations can create ordering complexity earlier than expected.

### 8. Mitigations for the risks

- Name this as the Gate 1 schema slice and avoid adding tables not needed for ACL retrieval validation.
- Keep fixture helpers below the domain layer and avoid exposing them as runtime authorization APIs.
- Add a follow-up note in this plan that realistic-volume RLS validation remains a later Gate 2+ requirement.
- Prefer constraint migrations if table creation and composite FK creation create circular ordering.

### 9. Consequences of not implementing this PR

- The Ragie filter decision would be detached from tenant isolation, which is the real security property it protects.
- Continuous regression would be harder to place into the tenant-leak suite.
- Later PRs would need to retrofit migration ordering, RLS, and composite FK discipline under more pressure.

### 10. Downsides of implementing this PR

- It adds database work before user-facing flows exist.
- Some schema details may be revised when `resolveRetrievalConstraints`, Source Access, and ingestion are implemented.
- The test harness may feel heavier than a week-1 spike, but it prevents the spike result from becoming tribal knowledge.

---

## PR 3: Validate Ragie Array ACL Filter Semantics and Adopt the Passing Encoding

### 1. Intent

Settle Gate 1's primary question with real Ragie behavior: does `$in` over array-valued `acl_scope_ids` match on any overlap, as Ragie's public docs currently state?

If it passes, this PR adopts array-valued `acl_scope_ids` as the Phase 0 metadata encoding and wires the continuous regression test.

### 2. Scope of changes

- Add a live Ragie integration test target that:
  - Creates or resets a dedicated test partition.
  - Indexes documents with `acl_scope_ids = ["A", "B"]`, `["C"]`, `[]`, and representative tenant/vault/status metadata.
  - Runs retrievals with `$in: ["B", "C"]`, `$in: ["A"]`, `$in: ["D"]`, and an empty allowed-scope set.
  - Verifies any-overlap semantics and fail-closed behavior for empty effective scopes.
- Add a canonical metadata builder in `platform-ragie` for Gate 1 fields:
  - `tenant_id`
  - `vault_id`
  - `internal_document_id`
  - `status`
  - `acl_scope_ids`
  - `sensitivity_rank`
- Add a canonical filter constructor for the selected array encoding:
  - exact tenant match.
  - exact vault match.
  - status equals `published`.
  - ACL overlap through `$in`.
  - sensitivity ceiling comparison.
- Add a post-Ragie validation helper that consumes fixture citation mappings and verifies tenant, vault, status, ACL intersection, and sensitivity rank before a result is accepted.
- Wire the live Ragie array-filter check into the tenant-leak suite as the Gate 1 continuous regression.
- Record evidence from the live run in CI artifacts or a checked-in sanitized run note, with no secret values.

### 3. External prerequisites

- PRs 1 and 2 merged, including the Ragie client wrapper, fixture schema, tenant-leak harness, and secret contract declaration.
- A non-production Ragie account or project with permission to create, index into, query, and clean up dedicated test partitions.
- A Ragie API key provisioned through the approved secret runtime for protected/shared CI, plus a documented local-development override path for engineers running the spike manually.
- Sufficient Ragie quota and rate limits for repeated indexing/query test runs without interfering with demos or other development tenants.
- Network egress from CI to Ragie, and any allowlisting required by the Ragie account or the CI environment.
- A team-agreed place to store sanitized validation evidence, such as CI artifacts, a runbook note, or an architecture-linked evidence file.
- Optional but useful: Ragie dashboard/admin access for manual cleanup if a live test run fails before deleting its test partition or documents.

### 4. Tests to be added by the PR

- Live Ragie test for array `$in` any-overlap semantics.
- Unit tests for the metadata builder, including sorted/stable ACL scope hashing if `last_indexed_acl_hash` is introduced here.
- Unit tests for the filter constructor proving it always includes `tenant_id`, `vault_id`, `status`, ACL filter, and sensitivity ceiling.
- Unit tests for empty effective ACL scopes returning a deny/no-call result rather than a broad filter.
- Post-Ragie validation tests that drop results for wrong tenant, wrong vault, unpublished status, non-intersecting ACL scopes, and excessive sensitivity.
- Tenant-leak suite regression that runs the live Ragie check when credentials are available and fails closed in protected/shared CI if the check is required but not configured.

### 5. Docs to be added or updated by the PR

- Update `phase_0_architecture.md` section 16 risk #1 with status `mitigated`, the validation date, the Ragie environment/partition class used, and a link or pointer to the CI artifact or sanitized evidence.
- Update architecture sections 6.2, 6.5, 8.3, and 11.2 only if the implemented filter or validation shape differs from the text.
- Update `phase_0_engineering_companion.md` Gate 1 checklist to mark the real Ragie confirmation and continuous regression items complete.

### 6. Acceptance criteria

- A real Ragie call proves that `acl_scope_ids = ["A", "B"]` matches `$in: ["B", "C"]`.
- The selected array encoding is implemented through metadata build, filter construction, and post-Ragie validation helpers.
- The Gate 1 live regression is part of the tenant-leak suite.
- Empty effective ACL scope sets cannot produce a permissive Ragie query.
- Architecture risk #1 is marked mitigated with evidence.
- If the real Ragie call does not prove any-overlap semantics, this PR does not merge as a passing Gate 1 PR; proceed to PR 4 instead.

### 7. Risks related to the PR

- Ragie indexing may be eventually consistent, making the live test flaky.
- Test partition cleanup may fail and pollute future results.
- Ragie query syntax may differ subtly between indexing APIs, retrieval APIs, and future SDK versions.
- A passing synthetic test may not cover real document ingestion metadata shape.
- Live tests can become slow or unavailable during provider incidents.

### 8. Mitigations for the risks

- Poll for indexing completion with a bounded timeout and explicit diagnostics.
- Use unique test document IDs per run and clean up by partition prefix where Ragie supports it.
- Test through the same wrapped `platform-ragie` client that runtime code will use.
- Include representative metadata fields beyond ACL scopes, especially tenant, vault, status, and sensitivity.
- Split local fast tests from protected/shared live checks while keeping the live check mandatory before Gate 1 is declared passed.

### 9. Consequences of not implementing this PR

- The team would continue building on the highest-priority unvalidated assumption in the architecture.
- Later retrieval and source-access work might need expensive rewrites if the array behavior is wrong.
- Gate 2 tenant-leak testing would not have a trustworthy ACL metadata encoding underneath it.

### 10. Downsides of implementing this PR

- It adds provider-backed CI complexity early.
- It may require spending time on Ragie test isolation and cleanup rather than product code.
- If Ragie behavior differs from the current docs or is inconsistent, the PR may expose a larger design decision sooner than planned.

---

## PR 4: Conditional Fallback - Boolean-Per-Scope Metadata Encoding

Only implement this PR if PR 3 proves that Ragie does not support any-overlap semantics for `$in` over array-valued `acl_scope_ids`, or if the behavior is too inconsistent to trust as the security pre-filter.

### 1. Intent

Preserve the Phase 0 authorization model by replacing array-valued ACL metadata with a boolean-per-scope encoding that Ragie can filter deterministically.

This PR is the alternate path to pass Gate 1.

### 2. Scope of changes

- Replace the canonical Ragie metadata encoding for ACL scopes with boolean metadata keys such as `acl_scope_<stable_scope_key> = true`.
- Add a stable, collision-resistant scope-key derivation rule that is safe for Ragie metadata key constraints.
- Update the metadata builder to emit boolean ACL keys for every document ACL scope.
- Update the filter constructor to OR together allowed scope boolean keys while still requiring tenant, vault, status, and sensitivity filters.
- Update post-Ragie validation to continue using authoritative database ACL intersections, not only the boolean metadata fields.
- Update citation mapping assumptions and any `last_indexed_acl_hash` logic so debugging still distinguishes stale metadata from authz bugs.
- Add migration or backfill guidance for later ingestion PRs so already-indexed documents can be reindexed if the encoding changes after early test data exists.
- Keep the old array test as provider-behavior documentation, but mark it as proving the fallback requirement rather than as the production encoding.

### 3. External prerequisites

- PR 3 completed far enough to produce trustworthy evidence that array-valued ACL metadata is unsafe or unsuitable for the production pre-filter.
- The same non-production Ragie account, API key, CI secret wiring, network egress, and test-partition permissions required by PR 3.
- Access to Ragie's current metadata key, value, and filter-complexity limits so the boolean key format and OR-filter shape can be designed against real constraints.
- Enough Ragie quota to run a small performance sanity check with representative allowed-scope counts.
- Product/security approval to change the architecture's chosen metadata encoding before later ingestion and retrieval work begins.
- A documented decision from the team that any Gate 1 experimental documents created with the array encoding can be deleted or reindexed.

### 4. Tests to be added by the PR

- Unit tests for stable scope-key derivation, including malformed IDs, long IDs, and collision cases.
- Unit tests for boolean metadata building from zero, one, and many ACL scopes.
- Unit tests proving empty effective scope sets deny before Ragie rather than building an OR over no clauses.
- Filter constructor tests proving tenant, vault, status, ACL boolean OR, and sensitivity constraints are always present.
- Live Ragie regression proving boolean-per-scope filters return only documents whose boolean scope keys match.
- Tenant-leak regression using the boolean encoding against real Ragie.
- Post-Ragie validation tests proving a result with stale boolean metadata is dropped if DB ACL scopes no longer intersect.

### 5. Docs to be added or updated by the PR

- Update `phase_0_architecture.md` section 16 risk #1 with status `mitigated by fallback`, validation date, and evidence for why array semantics failed or were rejected.
- Update architecture sections 6.2, 6.5, 8.3, 11.2, and any metadata examples to describe boolean-per-scope encoding instead of array-valued `acl_scope_ids`.
- Update `phase_0_engineering_companion.md` Gate 1 checklist to mark the fallback implementation and continuous regression items complete.
- Add a note to the implementation sequence that later ingestion work must use the boolean metadata builder and must reindex any documents created by Gate 1 experiments.

### 6. Acceptance criteria

- Boolean-per-scope metadata is implemented end-to-end for metadata build, filter construction, citation mapping assumptions, and post-Ragie validation.
- A real Ragie regression proves the boolean filter returns expected scoped results.
- The tenant-leak suite contains the live boolean metadata regression.
- Architecture and engineering companion documents no longer imply array-valued ACL metadata is the chosen production path.
- Gate 1 can be marked passed without trusting Ragie array-overlap behavior.

### 7. Risks related to the PR

- Boolean-per-scope metadata can grow large for documents with many ACL scopes.
- Metadata key derivation can create collisions or invalid Ragie keys if not designed carefully.
- OR filters over many scopes may be slower or hit Ragie filter complexity limits.
- Updating the architecture from array to boolean encoding may require careful edits across examples and test descriptions.
- Future ingestion and reindexing work must consistently use the fallback path.

### 8. Mitigations for the risks

- Add key-length and scope-count limits with explicit failures before indexing.
- Use a deterministic encoded or hashed key format and test collision handling.
- Run a small performance sanity check with representative allowed-scope counts and record the result.
- Search the architecture and companion docs for `acl_scope_ids` during the PR and update every production-path reference.
- Centralize metadata construction so later ingestion cannot hand-roll ACL fields.

### 9. Consequences of not implementing this PR

- If array-overlap semantics fail, the Phase 0 ACL model has no safe Ragie pre-filter.
- Continuing to later gates would violate the engineering companion's instruction not to start week-2 work until Gate 1 is settled.
- Any retrieval demo would rely on post-filtering as the effective security boundary, which the architecture explicitly rejects.

### 10. Downsides of implementing this PR

- It makes Ragie metadata less human-readable.
- It may increase metadata size and filter complexity.
- It adds migration/reindexing considerations earlier than the array encoding would.
- It creates more architecture-doc churn because the current architecture is written around `acl_scope_ids`.

---

## Gate 1 Exit Criteria

Gate 1 is complete after PR 3 merges on the array path, or PR 4 merges on the fallback path.

Before starting Gate 2 work, confirm:

- The selected metadata encoding is the only encoding exposed by `platform-ragie`.
- The tenant-leak suite includes a live Ragie regression for the selected encoding.
- Architecture section 16 risk #1 is marked mitigated with evidence.
- `phase_0_engineering_companion.md` Gate 1 checklist reflects the actual path taken.
- Any remaining architecture section 16 risks touched by these PRs are either still open with explicit notes or marked mitigated only with evidence.
- Later PR plans use the selected encoding for ingestion, retrieval, citations, and post-Ragie validation.
