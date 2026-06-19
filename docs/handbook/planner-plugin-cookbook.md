### Planner plugin cookbook

Planner plugins live under `viberoots/build-tools/tools/nix/planner/<id>.nix` and implement `{ isTarget, kindOf, modulesFileFor, mkApp, mkLib }`.

- **Discovery**: `viberoots/build-tools/tools/nix/graph-generator.nix` enumerates language IDs from `viberoots/build-tools/tools/nix/langs.json` and imports matching files.
- **Scaffold**: `node viberoots/build-tools/tools/dev/planner-gen.ts --lang <id>` can generate a starter from a TS config.
- **Kinds**: implement `kindOf(name)` returning `"bin" | "lib" | null`.
- **Modules**: reuse `modulesTomlFor name` or inherit Go modules when appropriate.
- **Tests**: build via `nix build .#graph-generator` and assert outputs exist (bins/libs) for simple fixtures.
