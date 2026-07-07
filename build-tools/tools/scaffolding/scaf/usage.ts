export function usage() {
  console.log(`scaf <command> [...]

Commands:
  templates [<language>] [--details|--json]
  new <language> <template> <name> [--path=DEST] [--key=value ...]
  language <new|plan|doctor|remove> [...]
  update <all|path1 path2 ...>
  regen  <all|path1 path2 ...>
  delete <all|path1 path2 ...> [--yes] [--dry-run]
  move <old-path> <new-path> [--yes] [--dry-run]
  ls [--json]
  help <language> <template> [--json]
  template <language> <template>
  validate <all|path1 path2 ...> [--quiet]
  completions <bash|zsh|fish>
  new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]
`);
}
