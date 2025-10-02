### Design: `scaf go test <name_of_test>`

This command creates a Go test file with a single empty/passing test that is auto‑wired by existing Buck macros.

### Goals

- One command to drop a ready‑to‑run `*_test.go` file.
- Defaults that “just work” inside scaffolded Go lib/app directories.
- No TARGETS edits required; relies on the auto‑wiring in `go/defs.bzl`.

### Command

- Syntax: `scaf go test <name_of_test> [--path=DEST] [--yes] [--dry-run]`
- Default path behavior:
  - If `--path` not provided, write to `./<name_of_test>.go` in the current directory.
  - If the basename doesn’t end with `_test.go`, append `_test.go`.
- Overwrite policy: do not overwrite existing files unless `--yes` is passed.
- Dry run: print the plan and exit without writing.

### Auto‑wiring expectations (existing behavior)

- Lib tests are discovered from `pkg/**/*_test.go` beneath a `nix_go_library` directory.
- App (CLI) tests are discovered from `cmd/<app>/**/*_test.go` beneath a `nix_go_binary` directory; a companion package library is synthesized automatically.
- Therefore, to get auto‑wiring:
  - Place tests under `libs/<lib>/pkg/<pkg>/` for libraries.
- Place tests under `apps/<app>/cmd/<app>/` for CLIs.
- If the current directory doesn’t match these shapes and `--path` is omitted, the file will still be created, but Buck auto‑wiring may not pick it up; the command will emit a friendly warning suggesting a suitable path.

### Package and test naming

- Package name resolution:
  1. If there is any existing `*.go` in the target directory, use the first file’s `package` (regex parse).
  2. Else if the target path includes `/cmd/`, use `main`.
  3. Else use the directory basename, sanitized to a valid Go package identifier.
- Test function name: convert `<name_of_test>` to PascalCase (strip `-_/` and non‑alnum), prefix with `Test`. Example: `scaf go test http_server` → `func TestHttpServer(t *testing.T) {}`.

### File contents (v1)

```go
package <resolved_pkg>

import "testing"

func Test<PascalName>(t *testing.T) {
}
```

Optionally, after write, best‑effort `go fmt <file>` (non‑fatal on failure).

### UX and safety

- If `--path` is outside a Git repo or a scaffolded structure, proceed but print a hint:
  - “Note: Buck auto‑wiring looks under pkg/** (libs) or cmd/** (apps). Consider --path=… for auto discovery.”
- If destination exists and `--yes` not set, abort with a clear message.
- Always create parent directories.

### CLI integration plan

- Extend `tools/scaffolding/scaf.ts` with a new command group:
  - `scaf go test <name> [--path=DEST] [--yes] [--dry-run]`
  - Parser: add top‑level `go` with subcommand `test`.
  - Help: add `scaf help go test` to show usage and examples.
  - Completions: add `go` and `test` subcommands to bash/zsh/fish output.

### Implementation sketch (scaf.ts)

- Command dispatch:
  - In `main()`: handle `case "go"` then sub‑switch on `rest[0] === "test"`.
- `cmdGoTest(name: string, flags)`:
  - Resolve `dest`: `flags.path ?? path.join(process.cwd(), ensureSuffix(name, "_test.go"))`.
  - Guard overwrite with `--yes`/`--dry-run`.
  - Determine `pkg` via rules above (try parse existing `*.go` or infer). Fallbacks: `main` if under `/cmd/`, else directory basename.
  - Render file from the template string and write.
  - Best‑effort run: `go fmt <dest>` (ignore errors).
  - Emit a short note if the path may not be auto‑wired by Buck.

### Tests (zx)

- `tools/tests/scaffolding/scaf-go-test.lib.auto-wires.test.ts`
  - Scaffold lib: `scaf new go lib demo-lib --path=libs/demo-lib`.
  - Run: `scaf go test demo_case --path=libs/demo-lib/pkg/demo-lib/demo_case_test.go`.
  - `tools/dev/install-deps.ts --glue-only`.
  - `buck2 test --target-platforms prelude//platforms:default //libs/demo-lib:demo-lib_test` → pass.

- `tools/tests/scaffolding/scaf-go-test.cli.auto-wires.test.ts`
  - Scaffold app: `scaf new go cli demo-cli --path=apps/demo-cli`.
  - Run: `scaf go test main_case --path=apps/demo-cli/cmd/demo-cli/main_case_test.go`.
  - Glue; then `buck2 test --target-platforms prelude//platforms:default //apps/demo-cli:demo-cli_test` → pass.

Note: TARGETS is already using `auto_zx_tests`, so these new tests auto‑register.

### Future enhancements

- `--pkg` flag to explicitly set package name.
- `--external` to generate `package <name>_test` style.
- Additional templates (table‑driven, benchmarks) via `--style=basic|table|bench`.

### Appendix: PR plan and detailed designs

#### PR 1 — feat(scaf): add `scaf go test` command

- Scope
  - Introduce a new top‑level `go` command group with a `test` subcommand in `tools/scaffolding/scaf.ts`.
  - Implement path resolution, package detection, file generation, best‑effort formatting, usage/help, and shell completions.

- UX/CLI
  - Command: `scaf go test <name_of_test> [--path=DEST] [--yes] [--dry-run]`
  - Default destination: `./<name_of_test>_test.go` (suffix enforced). Parent directories auto‑created.
  - Overwrite guard: refuse to overwrite unless `--yes`.
  - Dry run: print the computed destination and inferred package, do not write.
  - Hints: warn when the resolved path is not under `pkg/**` (libs) or `cmd/<app>/**` (apps).

- Implementation details (files and functions)
  - `tools/scaffolding/scaf.ts`
    - Parser: accept `go` as first token, then subcommand dispatch for `test`.
    - Add `cmdGoTest(name: string, flags: Record<string,string>)`:
      - Resolve destination path: `flags.path ?? path.join(process.cwd(), ensureSuffix(name, "_test.go"))`.
      - Determine package:
        1. If any `*.go` exists in `path.dirname(dest)`, parse the first file’s `^package\s+(\w+)`.
        2. Else if `dest` contains `/cmd/`, use `main`.
        3. Else derive from directory basename: sanitize to `[a-zA-Z_][a-zA-Z0-9_]*` (lowercase, replace non‑alnum with `_`, leading digit → prefix `_`).
      - Render minimal test content and write file atomically (write tmp then rename).
      - Best‑effort `go fmt` on the new file (ignore failures).
      - Print a one‑line note if auto‑wiring may not pick it up (wrong subtree).
    - Help and completions:
      - Extend `usage()` to list `go test`.
      - Extend `cmdHelp()` to support `scaf help go test` (plain and `--json`).
      - Extend `cmdCompletions()` to include `go` and `test` in bash/zsh/fish output.

- Content template (described)
  - Header: `package <resolved_pkg>`
  - Imports: `import "testing"`
  - Body: `func Test<PascalName>(t *testing.T) {}` where `<PascalName>` is `<name_of_test>` in PascalCase (`http_server` → `HttpServer`).

- Acceptance criteria
  - Running `scaf go test demo_case` in any directory creates `./demo_case_test.go` with a passing test and no overwrite unless `--yes`.
  - In `libs/<lib>/pkg/<pkg>`, running `scaf go test x` and then `buck2 test --target-platforms prelude//platforms:default //libs/<lib>:<lib>_test` passes.
  - In `apps/<app>/cmd/<app>`, running `scaf go test x` and then `buck2 test --target-platforms prelude//platforms:default //apps/<app>:<app>_test` passes.

- Risks / mitigations
  - Package inference edge cases: prefer parsing an existing file; fallback rules are deterministic and documented.
  - Non‑scaffolded layouts: we warn but still generate files; users can pass `--path`.
  - Idempotency: guarded by overwrite check; dry‑run offered.

#### PR 2 — test(scaffolding): zx tests validating auto‑wiring

- Scope
  - Add two zx tests verifying that files created via `scaf go test` are auto‑wired by our Buck macros without TARGETS edits.

- Files
  - `tools/tests/scaffolding/scaf-go-test.lib.auto-wires.test.ts`
  - `tools/tests/scaffolding/scaf-go-test.cli.auto-wires.test.ts`

- Test flow (both use `runInTemp` helper)
  1. Initialize a temp repo (helper writes `.buckconfig`, links `@prelude`, ensures toolchains cell).
  2. Scaffold target (lib or cli) with `scaf new`.
  3. `go mod tidy`; generate `gomod2nix.toml`; copy to repo root.
  4. `tools/dev/install-deps.ts --glue-only` to refresh glue.
  5. Invoke `scaf go test ... --path=...` into the canonical subtree:
     - Lib: `libs/demo-lib/pkg/demo-lib/demo_case_test.go`.
     - App: `apps/demo-cli/cmd/demo-cli/main_case_test.go`.
  6. Run Buck tests with explicit platform:
     - Lib: `buck2 test --target-platforms prelude//platforms:default //libs/demo-lib:demo-lib_test` → pass.
     - App: `buck2 test --target-platforms prelude//platforms:default //apps/demo-cli:demo-cli_test` → pass.

- Wiring
  - No changes to top‑level `TARGETS`; `auto_zx_tests` already discovers `tools/tests/**/*.test.ts`.

- Acceptance criteria
  - Both tests pass locally and in CI; total suite remains green with coverage.

#### PR 3 — docs(scaffolding): documentation and design status

- Scope
  - Update docs to surface the new command and mark the design implemented.

- Files
  - `README.md` and/or `scaffolding.md`: add a short “Go tests” section with:
    - Usage examples (lib and app).
    - Auto‑wiring expectations and canonical paths.
    - Notes on package inference and `--path`.
  - `scaf-go-test-design.md`: add a brief “Implementation status: Implemented” note.

- Acceptance criteria
  - `scaf help go test` output matches the docs and this design.
  - Links or references from `scaffolding.md` to the design or `help` are correct.

Implementation status: Implemented (PRs 1–3 merged)
