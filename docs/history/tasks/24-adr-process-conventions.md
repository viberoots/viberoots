# 27. Simple ADR Process / Conventions

**Tier:** Process & Governance
**Priority:** 27 of 44
**Depends on:** none
**Estimated effort:** S
**Blocks:** #41 (make viberoots public)
**Date:** 2026-05-25
**Summary:** Write `docs/adrs/README.md` documenting the numbering convention, required format, four valid statuses, authorship and review expectations, and when to write an ADR vs. just committing code.

## What

Write and commit a lightweight, single-page process document (`docs/adrs/README.md`) that
defines how Architecture Decision Records are proposed, reviewed, numbered, and when they are
required. The document must not prescribe heavyweight governance; it should describe the minimum
shared conventions needed to keep the existing ADR corpus (ADR-00001 through ADR-00008) coherent
and growing consistently.

**Required content:**

- **When to write an ADR.** Concrete criteria for when a decision warrants a record versus when
  committing code with a clear commit message is sufficient. Examples drawn from the existing ADRs:
  decisions that affect multiple provider families (ADR-00002), define a cross-cutting security
  boundary (ADR-00008), or choose between two structurally different approaches (ADR-00001's Buck2
  vs. Nix split). Not every technology choice is an ADR; adding a new deployment target to an
  existing provider family is not.

- **Numbering convention.** Five-digit zero-padded integer, incremented monotonically from the last
  committed ADR. The number is assigned when the file is created, not when it is accepted. No
  semantic meaning is attached to the number beyond ordering. New ADRs start from `00009`.

- **File naming and location.** `docs/adrs/<number>-<slug>.md` where the slug is kebab-case and
  describes the subject, not the decision. Examples: `00001-monorepo-structure`,
  `00006-secrets-management-strategy`. The slug must pass the `stale-names-lint` check; stale
  repository names (e.g., former project names) may not appear in ADR slugs or their content.

- **Required header fields.** Every ADR must have: `Status`, `Date`, and `Authors`. Status values
  are `Proposed`, `Accepted`, `Superseded`, or `Deprecated`. A superseded ADR records its
  replacement in the header: `Superseded by: ADR-NNNNN`. All current ADRs (00001–00008) carry
  `Status: Accepted`; new ADRs begin as `Proposed`.

- **Required sections.** `Context`, `Decision`, and `Consequences`. `Consequences` must include
  `Positive`, `Trade-offs`, and `Obligations` subsections. This matches the format used in all
  eight existing ADRs and must not be varied silently; a deliberate structural deviation requires a
  note in the ADR itself.

- **Proposal and review flow.** A `Proposed` ADR is a regular pull request. Review involves at
  least one other contributor checking that the context is accurate, the decision is clearly stated,
  and the obligations are actionable. There is no formal approval committee. The PR merges when the
  reviewer is satisfied and the author marks it `Accepted` in the header. For a solo contributor
  period, self-merge is permitted with a 24-hour cooling-off window after the initial draft is
  committed.

- **Linking from code and other docs.** When a code comment, design doc, or task description
  references an architectural decision, it should cite the ADR by number (e.g., `ADR-00003`), not
  by file path. This makes references stable across future file renames.

- **What does not require an ADR.** Tactical decisions (which library version, which flag to pass),
  reversals of a decision that has never been acted on, and changes that are already fully specified
  in an existing design doc that itself went through review.

## Why Now

ADR-00001 through ADR-00008 were written on 2026-05-25 as a single batch to record decisions that
had already been made and implemented. Without a process document, the next person to recognize a
decision worth recording has no guidance on: whether the decision qualifies, what number to use,
what review is expected, or how to mark the previous ADR superseded. The batch creation moment is
the best time to write down what was just done and why, while the format is fresh and the edge
cases are visible.

This task blocks #43 (making viberoots public) because external contributors need to understand how
architectural decisions are made and recorded. A public repository with eight ADRs but no process
doc implicitly signals that the ADRs were a one-time artifact rather than a living practice.

## Risks

**Overcorrection toward heavyweight process.** The "simple" qualifier is load-bearing. If the
process document grows to include mandatory templates for proposal emails, multi-stage approval
gates, or ratification timelines, it will be ignored. The document should be short enough to read
in two minutes. If a draft exceeds one page, cut it.

**Implicit gaps in the existing format.** The eight existing ADRs are consistent in structure but
were written in a single session by the same author. The first ADR written by a different
contributor will reveal whether the format description is precise enough. The `Obligations`
subsection is the most likely source of ambiguity: some ADRs use imperative sentences with explicit
actors (ADR-00002, ADR-00008), while others could be clearer. The process doc should include one
worked example of a well-formed `Obligations` entry.

**Stale-names enforcement on ADR content.** ADR prose is checked by `stale-names-lint`. If
context sections reference former project names (e.g., discussing the history before the
viberoots rename), the lint will fail unless those references are in an approved allowlist path.
Future ADRs that include migration history must either use only canonical names or route the file
through the allowlist mechanism defined in `docs/contributor-naming-conventions.md`.

**Numbering gaps if ADRs are abandoned.** If a `Proposed` ADR is withdrawn rather than accepted,
its number is consumed and leaves a gap. The process document should state the policy: withdrawn
ADRs are either deleted (if never merged) or marked `Deprecated` with a one-line explanation (if
merged). Do not renumber.

## Trade-offs

**Single-page doc vs. ADR-for-ADRs.** Writing an ADR that records the decision to use ADRs is
meta but not unreasonable. The trade-off here is that a standalone `README.md` in the ADR
directory is more discoverable for someone who just opened `docs/adrs/` than an ADR buried in the
list. A `README.md` also does not consume a number or carry a status, which is appropriate for a
living process document that will be amended rather than superseded. The recommendation is
`README.md`; a future team decision to replace it with a formal meta-ADR can be recorded then.

**Format rigidity vs. flexibility.** Locking the three required sections (`Context`, `Decision`,
`Consequences`) and the three `Consequences` subsections prevents format drift. The cost is that
unusual decisions — for example, a decision to _not_ adopt a pattern — are slightly awkward to
express. The existing ADRs demonstrate that the format handles this: ADR-00004 (tenant isolation)
and ADR-00005 (control-plane/data-plane boundary) both define what is _out of scope_ in the
`Decision` section. Document this technique explicitly rather than adding a fourth optional section.

**Named status values vs. free-form.** The four statuses (`Proposed`, `Accepted`, `Superseded`,
`Deprecated`) cover every state that any of the current ADRs needs. Adding more statuses
(e.g., `Under Review`, `On Hold`) requires updating the process doc and re-examining existing
ADRs. Resist additions until a concrete case demands one.

## Considerations

- The document should include a one-command way to find the next available ADR number:
  `ls docs/adrs/ | tail -1` gives the last numbered file. No tooling is required beyond this;
  do not add a script unless the process document is written and the need is demonstrated.

- The `stale-names-lint` tool already scans `docs/adrs/` for stale repository names. The process
  document should cross-reference `docs/contributor-naming-conventions.md` so ADR authors know the
  constraint before they start writing, not when the pre-commit hook fires.

- AGENTS.md's `DocumentationBuildingProcess` section asks "Is there enough documentation for
  future reference?" as a quality gate criterion. The ADR corpus answers this for architectural
  decisions. The process document completes the loop by explaining how the corpus grows.

- Do not backfill missing ADRs for decisions that predate the viberoots rename or for decisions
  already captured in design docs under `docs/`. The existing design documents (`docs/history/designs/deployments-design.md`,
  `docs/history/designs/infisical-design.md`, etc.) are not ADRs and do not need to become them. The ADR corpus
  starts at ADR-00001 (2026-05-25) and covers decisions made from that point forward, plus the
  eight retroactive records already written.

- If ADR-00001 through ADR-00008 are amended as part of this task (e.g., to add a `Superseded by`
  cross-reference or fix an `Obligations` entry), those amendments are in-place edits to the
  existing files, not new ADRs. In-place edits to `Accepted` ADRs are permitted only for
  factual corrections; substantive decision changes require a new superseding ADR.
