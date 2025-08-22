# Summary
A minimal Go library skeleton with a README.

# Usage
scaf new go lib <name> [--path=DEST]

# Variables
- name: library name (used for directory and title)
- language: fixed to "go"
- template: fixed to "lib"

# Generated
- README.md with title and brief info

# Post-steps
- None required for this minimal template

# Examples
- scaf new go lib auth-utils
- scaf regen libs/auth-utils

# Validation
Use `scaf validate all` to validate all templates, or target specific ones:
- `scaf validate tools/scaffolding/templates/go/lib`
