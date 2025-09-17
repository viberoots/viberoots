# Conventions

- Scripts are zx TypeScript with `#!/usr/bin/env zx-wrapper`.
- Path invariants: `patches/<lang>/` flat, tools in `tools/buck/`, Nix templates in `tools/nix/`.
- One patch per `module@version`.
- Minimal, deterministic code; files ≤ 250 LOC where practical.
- Conventional Commits for VCS.
