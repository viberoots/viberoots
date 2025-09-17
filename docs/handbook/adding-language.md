# Adding a Language

## Requirements

- Patches under `patches/<lang>/` (flat), one patch per key.
- Generator to write `third_party/providers/TARGETS.<lang>.auto` from patches.
- Label shape added to exporter; `gen-auto-map.ts` must map labels to provider names.
- Provider naming via `tools/lib/providers.ts`.

## Steps

1. Add exporter labels (e.g., `lockfile:<path>#<importer>` for Node).
2. Add sync generator writing `TARGETS.<lang>.auto`.
3. Ensure `gen-auto-map.ts` maps labels to providers.
4. (Optional) Extend CI to run the language-specific sync stage.
