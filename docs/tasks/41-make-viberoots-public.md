# 43. Make viberoots Public

**Tier:** Advanced Capabilities / Public Release
**Priority:** 43 of 44
**Depends on:** #27 Simple ADR Process / Conventions, #28 Document Simple SDLC, #32 Internal PKI / Service Auth Strategy, #33 Secret Rotation Policy & Workflows, #35 SBOM Generation, #36 Supply-Chain Scanning, #37 Validated Backup/Restore/Disaster Recovery Procedures, #42 Clean Up / Organize viberoots Docs
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Complete the pre-flight checklist before setting the repo to public: entropy-based history audit, `LICENSE` file, responsible disclosure policy, resolve `kiltyj` namespace references in auth config, CC BY-SA 4.0 attribution for `METHODOLOGY.XML`, and harden fork-PR CI secret exposure.

## What

Flip the GitHub visibility of `viberoots/viberoots` from private to public and complete the
surrounding hygiene work that makes public exposure responsible rather than incidental.

The mechanical act of changing visibility takes seconds. The work in this task is everything that
must be true before and immediately after that switch:

**Pre-flight verification (before flipping visibility)**

1. **Git history audit.** Run `git log --all --full-history` and `git secrets --scan-history` (or
   equivalent `trufflehog`/`gitleaks` sweep) against the full commit history to confirm that no
   credentials, API keys, Infisical tokens, Infisical client secrets, bootstrap credentials, or internal
   hostnames appear in any committed file or commit message. The SprinkleRef contract
   (`docs/adrs/00006-secrets-management-strategy.md`) requires that secrets never appear in checked-in
   metadata; verify this holds retroactively across all commits, not just HEAD.

2. **Stale-names enforcement passing.** Confirm `stale-names-lint` passes cleanly across all
   active source and docs. No stale repository names, legacy environment prefixes, old personal
   remotes, legacy deployment paths, or old remote URL references may be present in active source
   outside their approved allowlist paths (see `docs/repo-rename.md`). The rename sequence closes
   these gaps; this task verifies they are fully closed before public exposure.

3. **Licensing declared.** Add a `LICENSE` file to the repository root. The `METHODOLOGY.XML`
   header declares that its methodology content is licensed CC BY-SA 4.0 (Disciplined AI Software
   Development Methodology © 2025 by Jay Baleine). The source code license must be separately
   declared. At minimum this means deciding and documenting which license applies to the build
   tooling and application source (separate from the CC BY-SA 4.0 methodology). The `LICENSE` file
   must be present and syntactically correct before visibility is changed.

4. **Public docs coherent.** All documents in `docs/` that will be publicly readable must be
   internally consistent and must not reference internal-only systems, private hostnames, or
   internal URLs without qualification. The ADR corpus (ADR-00001 through ADR-00008), the handbook,
   the deployment contract (`docs/deployments-contract.md`), and the SDLC doc (`docs/handbook/sdlc.md`)
   are the highest-visibility surfaces. Each must be readable by someone with no prior context.

5. **No personal namespace references in active source.** The repo-rename plan
   (`docs/repo-rename.md`) moves the canonical remote to the organization-owned repository. Before
   going public, active source, operator docs, NixOS host configs, CI fixtures, and deployment auth
   claims must not reference a personal namespace or its SSH remote. The OIDC trust policies,
   Infisical role bindings, and deployment governance must all point at the organization-owned
   repository.

6. **Security policy.** Add a `SECURITY.md` file at the repository root describing a responsible
   disclosure policy. At minimum: how to report a security vulnerability (an email address or a
   GitHub private vulnerability reporting link), what the response commitment is (acknowledgement
   within N business days), and the scope of what is in and out of policy for disclosure
   (control-plane production endpoints, admitted artifact integrity, SprinkleRef resolution).

7. **`README.md` oriented for external readers.** The current `README.md` is a build-system
   quickstart for an insider audience. Before going public it must include at minimum: a one-paragraph
   description of what viberoots is (a multi-language monorepo with a Nix-first hermetic build and a
   control-plane-admitted deployment model), a pointer to the SDLC doc and contributor guide, a
   pointer to the ADR corpus for architectural context, and the license statement.

**Post-flip immediate actions (within 24 hours of going public)**

8. **Enable GitHub branch protection on `main`.** Require passing CI (all three matrix platforms),
   require at least one review for PRs from non-maintainers, and prohibit force-push. This cannot be
   enforced while the repo is private without affecting developer flow unnecessarily, but it must be
   active before the first external contributor could open a PR.

9. **Add `CONTRIBUTING.md`.** A minimal guide describing: how to set up the dev environment
   (pointing to the SDLC doc), the `i && b && v` pre-push requirement, the Conventional Commits
   format, and the PR review standard against `METHODOLOGY.XML`. The file should be short (one page
   or less) and link out to `docs/handbook/` rather than duplicating it.

10. **Add `CODE_OF_CONDUCT.md`.** A standard code of conduct (Contributor Covenant v2.1 is the
    conventional baseline). This is a social contract, not an engineering decision, but GitHub
    surfaces it prominently for public repos and its absence signals neglect to potential contributors.

11. **Verify GitHub Actions / CI permissions.** If Jenkins webhooks or GitHub Actions are in use,
    confirm that no CI secret, Infisical token, or deployment credential is accessible to fork-sourced PR
    runs. The supply-chain and admission model (ADR-00008) already requires CI-submitted artifacts
    to be bound by identity; verify that pull-request CI workflows do not expose secrets to
    untrusted PR contributors. Fork-based PR runners must be limited to read-only build and test
    operations with no access to deployment credentials or admission reporter identities.

## Why Now

Priority 41 of 44 is not incidental. Going public requires most of the security and process work
that precedes it to be complete:

- **#32 Internal PKI / Service Auth** must be complete because a public repo invites security
  scrutiny of the control plane's service-to-service auth model. An undocumented or unreviewed
  service auth posture would be the first finding from any external security review.
- **#33 Secret Rotation** must be in place because once the repo is public, the surface area for
  any inadvertently exposed credential to be observed by an attacker expands immediately.
- **#36 Supply-Chain Scanning** and **#35 SBOM** must be operational because a public monorepo
  that admits OCI artifacts to production without demonstrable supply-chain verification is not
  credible to security-conscious enterprise users or external contributors who would be reviewing
  the admission model.
- **#37 Backup/DR** must be validated because the deployment records and stage state that any
  external user of the deploy CLI depends on must be durably maintained — "we don't have validated
  restore procedures" is not an acceptable posture when operators outside the original team are
  relying on the control plane.
- **#27 ADR Process** and **#28 SDLC Doc** must exist because a public repo without a contributor
  entry point and without a documented process for how architectural decisions are made signals
  that the project is not ready for external collaboration even if the code is good.
- **#42 Docs Cleanup** must be complete because public docs that reference internal-only endpoints,
  unfinished migration terminology, or deprecated model language create a confusing and misleading
  first impression.

The repo is not going public to find contributors at this moment — it is going public because a
closed-source monorepo that is the upstream source for other deployments is a liability for
auditability, reproducibility proofs, and operator trust. Public visibility is the end-state for a
project whose design docs, ADRs, and deployment model are intended to be readable by the teams and
operators who rely on it.

## Risks

**Credential in history is undetected until after exposure.** The git history audit (step 1) is
not optional and must be run by a tool with comprehensive pattern coverage, not a manual grep. A
single undetected API key in a 2-year-old commit that predates the SprinkleRef migration becomes a
public credential the moment visibility is flipped. Mitigation: use both `trufflehog --since-commit
<initial>` (entropy-based detection) and `gitleaks` (pattern-based) and resolve every finding
before proceeding. If a real credential is found in history, the options are: rewrite history (if
the credential is still active and the cost of forced-history rewrite is acceptable), rotate the
credential immediately and document the historical exposure as resolved, or do not go public until
the history is clean.

**Inadvertent internal reference in a public ADR or design doc.** The eight ADRs and the design
docs under `docs/` will be fully readable by anyone. If any of them reference internal hostnames
(internal hosts, internal VPN addresses), private GitHub org resources, or internal-only tooling that an
external reader cannot reach, it creates confusion and may expose information about infrastructure
topology. The pre-flight doc coherence check (step 4) must scan all docs that will be public, not
only the ADRs.

**Fork-PR CI secret exposure.** If GitHub Actions workflows are configured with secrets that run on
PRs from forks, any external contributor who opens a PR gets code execution in an environment that
may have access to deployment credentials or OIDC tokens. This is the most commonly exploited CI
misconfiguration in newly-public repos. The mitigation (step 11) is mandatory, not advisory.

**Stale repo-rename residue in generated or checked-in outputs.** The `stale-names-lint` tool
enforces active source but may not cover all checked-in generated artifacts (`pnpm-lock.yaml` is
already in the allowlist for a reason). Any checked-in generated file that happens to contain an
old identity string is not caught by content enforcement. The pre-flight check must also verify the
most sensitive checked-in generated files (manifests, deployment fixtures, golden outputs) manually
before flipping visibility.

**License ambiguity.** The `METHODOLOGY.XML` is CC BY-SA 4.0. The source code has no declared
license until step 3 adds one. An unlicensed public repository is technically "all rights reserved"
by default under copyright law, which means external contributors cannot legally use or contribute
to the code without explicit permission. This creates a practical and legal problem for any
downstream operator of the repo's build tooling. The license must be chosen and documented before
the repo goes public, not after.

## Trade-offs

**Full history rewrite vs. credential rotation if something is found.** If the history audit
reveals a committed credential that is still active, the two paths are: rewrite git history (removes
the credential from the record, forces all collaborators to re-clone, permanently rewrites commit
SHAs — significant operational cost for a low-probability event) or immediately rotate the
credential and document the historical window of exposure without rewriting history. The second path
is operationally cheaper and is sufficient if the credential is rotated before visibility is
changed. The first path is required if rotation is impossible or if the credential was for a system
that cannot be rotated. This decision cannot be pre-decided; it depends on what the audit finds.

**Minimal public README vs. comprehensive one.** A comprehensive public README that fully documents
the build system, CI stages, and deployment model duplicates the handbook and creates a maintenance
burden. A minimal README that describes the project and links to `docs/` is lower maintenance but
requires external readers to navigate into the docs tree to understand what they are looking at.
The right level for the initial public README is: enough to explain the project's purpose and
unique design choices (Buck2 + Nix, SprinkleRef secrets model, control-plane-admitted deployments),
and links to the ADR corpus and SDLC doc for depth.

**Simultaneous vs. staged public release of docs vs. code.** An alternative to flipping the whole
repo public at once is to make the docs subtree public first via a separate docs-only repo, while
keeping the code private. This has been done by some projects to allow the design to be reviewed
without exposing implementation details. The downside is that it creates two repos to maintain and
makes the ADR-to-code cross-references unverifiable by external readers. Given that the viberoots
codebase is already build-tooling-centric (not a product with trade-secret business logic), a full
visibility flip is cleaner than a staged approach.

## Considerations

**The METHODOLOGY.XML attribution requirement is load-bearing.** The CC BY-SA 4.0 license on the
methodology requires that any public sharing of the methodology content carry the full attribution:
"Disciplined AI Software Development Methodology © 2025 by Jay Baleine, licensed under CC BY-SA
4.0, https://creativecommons.org/licenses/by-sa/4.0/." Once the repo is public, the `METHODOLOGY.XML`
file is public content. The attribution header already present in that file satisfies the
requirement for the file itself. The `README.md` and any external documentation that reproduces or
summarizes the methodology must also carry the attribution. Do not reproduce the methodology text
in the public README without the attribution; link to the file instead.

**GitHub's community health files are surfaced prominently.** GitHub displays `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, and `SECURITY.md` in a dedicated "Community standards" panel for public
repos. Their absence is surfaced as an explicit gap to anyone who visits the repo's Insights tab.
Completing all three before going public avoids creating a first impression of an incomplete or
unmaintained project.

**The `stale-names-lint` enforcement already covers the highest-risk surfaces.** The lint is wired
into pre-commit and verify/CI. The pre-flight check for this task is not about adding new
enforcement — it is about confirming that the existing enforcement has been green across all recent
merges and that no active source or operator doc contains stale names that were whitelisted for
transition purposes but are now eligible for removal from the allowlist.

**Going public is irreversible in practice.** Once the repo is public even briefly, any content
in it has likely been indexed by search engines, mirrors, or third-party tooling. There is no
reliable "unpublish." The pre-flight checklist (steps 1–7) must be treated as a hard gate, not
a best-effort check. Do not flip visibility while any item on the pre-flight list is in an
unknown state.

**Coordinate the visibility flip with any active operators.** At the time this task executes, the
the shared host operator and any CI/Jenkins administrators should be informed in advance. The
visibility change does not affect the control plane's behavior, but operators who maintain
OIDC trust policies, Infisical role bindings, or Jenkins job configs against the `viberoots/viberoots`
remote should confirm their configurations are stable before and after the flip.
