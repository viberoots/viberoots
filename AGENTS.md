# viberoots Agent Guide

This is the single active guidance file for agents working in viberoots or in a viberoots-enabled repository.

This guide is written for LLM consumption. Treat the sections below as active operating rules, not background reading.

The methodology portion is the project documentation methodology for this repo.

## Instruction Precedence

- Explicit user instructions in the current chat override this file.
- The nearest applicable `AGENTS.md` gives the most specific repository guidance.
- In a consumer workspace, follow `projects/AGENTS.md` for consumer-owned project code when it exists, while still obeying this file for viberoots methodology and tooling rules.

## Workspace Overview

viberoots is reusable workspace tooling consumed by project repositories. It provides the development shell, build macros, tool wrappers, scaffolding, templates, deployment helpers, verification flow, documentation conventions, and automation used by projects.

A viberoots-enabled consumer repository normally has this shape:

```text
consumer-repo/
├── README.md
├── projects/                 # consumer-owned apps, libraries, config, and product docs
├── .envrc                    # generated shell entry
├── .buckroot                 # generated Buck workspace marker
├── .buckconfig               # generated Buck cell wiring
└── .viberoots/
    ├── current -> ...        # active viberoots source
    ├── workspace/            # hidden generated workspace state
    └── bootstrap/            # bootstrap transaction records
```

In submodule contribution mode, the consumer repository also has:

```text
consumer-repo/
└── viberoots/                # Git submodule containing this source tree
```

Ownership boundary:

- Consumer-owned code belongs under `projects/`.
- viberoots-owned tooling belongs in this source tree.
- Generated hidden state belongs under `.viberoots/workspace/`.
- Do not manually install tools into a consumer repo. Tools must be installed, pinned, or surfaced through viberoots patterns.
- Do not copy viberoots-owned roots such as `build-tools/`, `toolchains/`, `patches/`, `plugins/`, `types/`, or `docs/` into the consumer parent root.

## Required First Reads

Start with these docs before changing code or advising users:

- [README.md](README.md): bootstrap, source modes, local commands, verification, and repo map.
- [TESTING.md](TESTING.md): canonical verification and coverage policy.
- [docs/README.md](docs/README.md): current repo documentation index and documentation placement rules.
- [docs/handbook/README.md](docs/handbook/README.md): contributor handbook.
- [docs/handbook/getting-started-on-a-pr.md](docs/handbook/getting-started-on-a-pr.md): PR workflow, validation habits, and execution-time guardrails.
- [docs/handbook/tooling.md](docs/handbook/tooling.md): tooling conventions and wrapper usage.
- [docs/handbook/testing.md](docs/handbook/testing.md): local verification workflow.
- [build-tools/docs/README.md](build-tools/docs/README.md): build-system documentation index.
- [build-tools/docs/build-system-design.md](build-tools/docs/build-system-design.md): build architecture and design constraints.
- [docs/viberoots-source-modes.md](docs/viberoots-source-modes.md): source modes, bootstrap behavior, and switching.
- [docs/viberoots-maintenance-commands.md](docs/viberoots-maintenance-commands.md): `viberoots gc`, generated-state cleanup, and maintenance commands.

## Hard Rules

- Do not manually install tools in `projects/` or consumer roots. Route tool installation through Nix, bootstrap, or viberoots wrappers.
- Do not copy viberoots-owned roots such as `build-tools/`, `toolchains/`, `patches/`, `plugins/`, `types/`, or `docs/` into the consumer parent root.
- Do not edit generated files unless the generator is also updated.
- Do not present an unverified claim as fact.
- Do not include or make performance-related percentage claims unless they are verifiable by empirical data.
- Do not add permanent guardrail documentation for a root cause until the cause is confirmed and the fix has shown meaningful improvement in comparable conditions.
- Keep consumer-owned state out of the viberoots source tree.
- Keep viberoots-owned tooling out of consumer project roots.
- Keep files at or below 250 lines. If a file would exceed that, split it into 2 or 3 clearly separated files with focused responsibilities.
- Reviewed file-size exceptions are declared in owner-local `methodology-exceptions.json` manifests. That filename refers to exceptions to this methodology, not to a separate methodology source file.
- Use automated checking and explicit validation points to prevent architectural principles from eroding during development.

## Common Commands

- Use `i` to install or refresh dependencies and generated glue.
- Use `b` for build validation.
- Use `v` for verification.
- Use focused `v` selectors before broad test runs.
- Use `ALL_TESTS=1 v` only when full-suite evidence is needed.
- Use coverage only when explicitly required by the current task, PR, or CI path.

## Security Considerations

- Do not manually install tools in `projects/` or consumer roots. Route tool installation through Nix, bootstrap, or viberoots wrappers.
- Treat non-default submodule remotes and bootstrap sources as trusted-code decisions because setup can run non-viberoots code.
- Keep secret values out of source files. Use the viberoots secret-reference and config patterns documented in the key usage docs.

## Interaction Rules

- Do not use overenthusiastic wording.
- Avoid phrasing such as paradigm, revolutionary, leader, innovator, mathematical precision, breakthrough, flagship, novel, enhanced, sophisticated, advanced, excellence, fascinating, and profound.
- Avoid em dashes and rhetorical effects.
- Use simple punctuation and short, clear sentences.
- Do not engage in small talk.
- Avoid friendly filler such as "That is what ties it all together," "That is a truly powerful and elegant connection," or "This is where your insight shines."
- Keep grounded in accuracy and realism. Ask whether each chat sentence contributes to the goal.
- Do not include or make performance-related percentage claims unless they are verifiable by empirical data.
- When uncertain, do not suggest. Use a ⚠️ emoji, explain the uncertainty, and list concrete steps the user can take to move toward certainty.
- Never state that you now know the solution or can see it clearly now. Wait for chat instructions telling you there was a solution.
- Terminology must be accurate and production ready.
- When writing documentation, write as the project owner in first-person perspective. Do not use marketing language or overconfidence.
- In technical writing, show observed behavior, reveal the reasoning process, and use concrete situations over abstractions.

## Empirical Discipline

- Immediately flag with 🔬 any instruction or request that cannot be empirically fulfilled.
- Never implement features, provide measurements, or claim capabilities that cannot be verified.
- When uncertain about actual capabilities versus simulated behavior, state the limitation before proceeding.
- Apply optimizations only to proven bottlenecks with measurable impact.
- Avoid premature optimization that clutters the codebase.
- Maintain performance baselines and regression detection.
- Treat "tests are passing" as insufficient evidence unless the relevant behavior is covered by those tests.

## Core Philosophy

Architectural minimalism with deterministic reliability: every line of code must earn its place through measurable value, not feature-rich design patterns. Build systems that must work predictably in production, not demonstrations of sophistication.

The approach is surgical:

- Target the exact problem with minimal code.
- Reuse existing components before building new ones.
- Resist feature bloat by asking whether each addition serves the core purpose.
- Prioritize deterministic behavior and long-runtime stability over cutting-edge patterns that may introduce unpredictability.
- Build production systems, not architecture demonstrations.

## Code Architecture Rules

Provide lightweight, performant, clean architectural code.

- Always use clearly separated, minimal, targeted solutions that prioritize clean architecture over feature complexity.

### Separation Of Concerns

- Each module and component must have a single, well-defined responsibility.
- Maintain strict modular boundaries with clear interfaces.
- Use a modular project layout with centralized main entry points.
- Treat separation of concerns as critical for project flexibility.
- Analyze whether separation would harm the architecture.
- Ask: do these pieces of code change for the same reason, at the same time? If yes, they should probably live together. If no, separation might be valuable.
- Ask: does the separation make the system easier to reason about, test, or evolve? If no, it is accidental complexity.

### Deterministic Operations

- Prefer synchronous, deterministic operations for production stability when async frameworks would add unnecessary complexity or failure points.
- Prefer predictable behavior over async complexity.
- Prefer production stability over development convenience.
- Account for cross-platform behavior in design decisions.

### Performance Decisions

- Choose technology based on workload requirements, not popular trends.
- Match performance characteristics to workload requirements.
- Evaluate the workload before choosing technology.
- Preserve readability and maintainability as primary concerns.
- Do not make performance improvements that sacrifice code clarity.
- Multiple languages are acceptable only when each serves a specific, measurable purpose and the added complexity is justified by measurable gains. That justification must include concrete performance gains and explain how the design leverages language strengths.

### Code Quality

- Keep files at or below 250 lines. If a file would exceed that, split it into 2 or 3 clearly separated files with focused responsibilities.
- Reviewed file-size exceptions are declared in owner-local `methodology-exceptions.json` manifests. That filename refers to exceptions to this methodology, not to a separate methodology source file.
- Keep code self-explanatory without comments.
- Avoid using comments in code. The code must be self-explanatory.
- When sharing code, always place it in its own artifact with clear path labeling.
- Apply KISS and DRY principles expertly.
- Reuse existing functions before creating new ones.
- Do not create redundant code.
- Preserve existing naming conventions.
- Keep naming conventions consistent across the codebase.
- Use existing configurations and follow the project architecture deterministically.
- Make surgical, minimal, targeted modifications.
- Keep dependencies aligned with architectural boundaries.
- Ensure each module serves a single, clear purpose.
- Maintain modular separation with clear boundaries.
- Keep constants centralized.
- Use centralized configuration throughout.
- Reference constants instead of magic numbers.

### Error Handling

- Favor robust error handling for reliable production behavior.
- Keep error handling robust without over-engineering.
- Implement what is necessary for production reliability.
- Handle situational failures such as network issues, disk full, and user errors.
- Avoid handling every possible edge case. Implement only what production reliability requires.
- Provide graceful failure modes and resource cleanup.
- Address real-world constraints, including deployment environment, resource limits, and operational failure modes.
- When dealing with edge cases, describe the edge case and suggest next steps. Do not add edge-case code until there is a mutually agreed plan.

### Feature Control

- Resist feature bloat and complexity creep.
- Every addition must serve the core project purpose.
- Prioritize clean architecture over feature complexity.
- Keep implementations minimal and targeted.
- Do not add abstractions unless they remove real complexity, reduce meaningful duplication, or match an established local pattern.

### Refactoring

- Before any refactor, explicitly document where each component will relocate and what functions require cleanup.
- If refactor details cannot be accurately determined, request project documentation rather than proceeding with incomplete planning.

## Phase 0 Requirements

Basic must-haves, always first:

Every project, regardless of size, must establish these foundations before feature development:

- Centralized entry points: one main module orchestrates the system.
- Configuration management: externalized settings with validation.
- Centralized logging: error handling and diagnostic output with JSON integration.
- Dependency injection: clean separation and testable components.
- Test suite: unit and integration tests for all components.
- Stress testing: load and boundary condition validation.
- Test data management: reproducible test scenarios and cleanup.
- Coverage tracking: ensure adequate test coverage before releases.

## Documentation And Planning Process

### Project Decomposition

Ask:

- What does finished look like?
- What major pieces need to exist?
- What depends on what?
- Where are the natural stopping points?

Create sections based on dependencies, such as Major Piece A, then Major Piece B, then Major Piece C, with matching subtasks.

### Phase Creation

Mandatory Phase 0 items:

- Test suite for regression detection.
- Test infrastructure, including unit and stress testing.
- Centralized architecture setup.

Group work by:

- Dependency chains: things that must happen in sequence.
- Logical groupings: related functionality that belongs together.
- Natural checkpoints: places where progress can be validated.

### Task Breakdown

Every task must state:

- Specific action: exactly what needs to be done.
- Output: what exists when complete.
- Success criteria: how completion is verified.
- Integration points: how it connects to other work.

### Progress Tracking

Use these statuses:

- `COMPLETED`: done and validated.
- `BLOCKED`: cannot proceed due to dependency.
- `READY`: dependencies met and work can start.
- `UNCERTAIN`: needs clarification or decision.

### Quality Gates

Ask:

- Does the output match what was specified?
- Can the next phase use this output?
- Is there enough documentation for future reference?
- Are there obvious issues that need fixing?

## Enforcement Framework

### Mandatory Checkpoints

- SoC validation: each module has one responsibility and clear boundaries.
- Deterministic behavior: synchronous operations produce predictable outcomes.
- File-size compliance: all files are at or below 250 lines or properly modularized.
- DRY enforcement: duplicate code is avoided and existing functions are reused.
- KISS validation: complexity is minimal and implementations are surgical.
- Configuration centralization: no hardcoded values outside constants.
- Performance integration: benchmarks are operational and gates are passing.
- Production readiness: error handling, resource cleanup, and cross-platform behavior are addressed.

Any failed checkpoint blocks phase advancement.

### Code Quality Gates

- Names are self-explanatory.
- Code must be self-explanatory without comments.
- Performance characteristics match workload requirements.
- Every addition serves the core project purpose.
- Regression tests prevent performance degradation.
- Tests link directly to all project modules for real testing during development so improvements and regressions are caught in real time.

### Mid-Phase Validation

During development:

- Check compliance after each significant change.
- Benchmark new components immediately and integrate those measurements with the benchmark and compliance gates.
- Ensure imports match architectural boundaries.
- Document edge cases, but do not implement unplanned edge-case handling.
- Question the necessity of each addition to check feature creep.

Before phase completion:

- Run a full architecture audit that systematically verifies all principles.
- Validate integration within system boundaries.
- Test under realistic deployment constraints.

### Automation Expectations

Validate phase script must:

- Check file sizes and fail if files exceed 250 lines.
- Scan for hardcoded values outside config.
- Validate import dependencies against architecture.
- Run benchmark suites and check gates.
- Generate compliance reports.

Dry audit script must:

- Detect duplicate function implementations.
- Find unused imports and functions.
- Identify constants that should be centralized.
- Flag potential separation-of-concerns violations.

Workflow integration must:

- Run validation before every commit.
- Block commits that fail compliance checks.

### Implementation Enforcement

Production readiness requires:

- Address real-world constraints.
- Clean up resources on shutdown.
- Preserve deterministic behavior under load.
- Use error handling appropriate for production.

## Scaling Guidelines

Single-file scripts:

- Apply separation of concerns within functions: input, processing, output.
- Benchmark the core operation even when simple.
- Validate against the 250-line limit and stay within it.
- Use self-explanatory function and variable names.

Small applications:

- Use strict modular boundaries and clear interfaces.
- Centralize configuration and constants.
- Prefer synchronous operations with predictable flow.
- Establish performance baselines.

Production systems:

- Maintain full architectural compliance with all principles.
- Use comprehensive testing.
- Use production-grade error handling and resource management.
- Address real-world constraints.
- Clean up resources on shutdown.
- Preserve deterministic behavior under load.

Multi-language projects:

- Maintain architectural principles across language boundaries.
- Use a unified test system for all components.
- Keep error-handling patterns consistent across languages.

## Success Indicators

Technical indicators:

- All architectural principles are consistently applied across the codebase.
- Testing is maintained through the development lifecycle.
- File-size constraints are met without compromising functionality.
- Zero production incidents are related to architectural violations.

Operational indicators:

- System uptime and reliability under production load.
- Predictable resource utilization patterns.
- Graceful degradation under stress conditions.
- Maintainability is preserved as the codebase grows.

Development indicators:

- Enforcement checkpoints prevent architectural drift.
- Performance regression detection catches optimizations and degradations.
- Code review efficiency improves through systematic validation.
- Technical debt accumulation is prevented through continuous compliance.

Documentation quality indicators:

- Enforcement checkpoints prevent architectural drift.
- Quality gates block progression with incomplete work.
- Automated validation catches compliance violations.
- Performance baselines are maintained throughout development.

Project execution indicators:

- Systematic validation prevents technical debt accumulation.
- Architectural principles are consistently applied across the codebase.
- Production readiness is verified at each phase.

## viberoots-Specific Working Rules

- Read [build-tools/docs/build-system-design.md](build-tools/docs/build-system-design.md) before build-system changes.
- Read [docs/handbook/getting-started-on-a-pr.md](docs/handbook/getting-started-on-a-pr.md) before PR implementation work.
- Use `rg` for discovery.
- Prefer existing utilities, helpers, wrappers, and local patterns.
- Use `i` to install or refresh dependencies and generated glue.
- Use `b` for build validation.
- Use `v` for verification.
- Use focused `v` selectors before broad test runs.
- Use `ALL_TESTS=1 v` only when full-suite evidence is needed.
- Use `viberoots status` for source-mode and extraction-readiness diagnostics.
- Use `viberoots gc --dry-run` before destructive local generated-state cleanup unless the user explicitly asks for normal cleanup.
- Do not manually install tools in `projects/` or consumer roots. Route tool installation through Nix, bootstrap, or viberoots wrappers.
- Generated state under `.viberoots/`, `buck-out/`, `.direnv/`, and `node_modules/` is not source of truth.
- Avoid editing generated files unless the generator is also updated.
- Keep consumer-owned state out of the viberoots source tree.
- Keep viberoots-owned tooling out of consumer project roots.

## When Unsure

- State what is known from files, logs, or commands.
- State what is inference.
- List the next commands or inspections needed to turn inference into evidence.
- Do not present an unverified claim as fact.
- Do not add permanent guardrail documentation for a root cause until the cause is confirmed and the fix has shown meaningful improvement in comparable conditions.
- Use automated checking and explicit validation points to prevent architectural principles from eroding during development.

## Conclusion

This methodology enforces discipline through automated checking and explicit validation points so architectural principles do not gradually erode during development.

## License And Attribution

Portions of this guide and methodology are based on the following source, with a few deletions, additions, and edits.

Full source attribution:

Disciplined AI Software Development Methodology © 2025 by Jay Baleine is licensed under CC BY-SA 4.0.

License: https://creativecommons.org/licenses/by-sa/4.0/

Attribution requirements:

- When sharing content publicly, including repositories, documentation, and articles, include the full attribution above.
- When working with AI systems, including ChatGPT, Claude, etc., attribution is not required during collaboration sessions.
- When distributing or modifying the methodology, full CC BY-SA 4.0 compliance is required.
