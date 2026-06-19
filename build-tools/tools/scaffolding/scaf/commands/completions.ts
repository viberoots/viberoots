import { readTemplateMeta } from "../templates/meta";
import { discoverScaffolds } from "../scaffolds/discover";

export async function cmdCompletions(args: string[]) {
  const [shell] = args;
  const subcommands =
    "templates new update regen delete move ls help validate template completions";
  if (shell === "bash") {
    console.log(
      [
        "_scaf_complete() {",
        "  local cur prev;",
        "  COMPREPLY=();",
        '  cur="${COMP_WORDS[COMP_CWORD]}"',
        '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
        `  local subs="${subcommands}"`,
        "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
        '    COMPREPLY=( $(compgen -W "$subs" -- "$cur") ); return;',
        "  fi",
        '  case "${COMP_WORDS[1]}" in',
        "    new)",
        "      if [[ ${COMP_CWORD} -eq 2 ]]; then",
        "        local langs=$(scaf templates --json 2>/dev/null | jq -r '.[].language' | sort -u);",
        '        COMPREPLY=( $(compgen -W "$langs" -- "$cur") ); return;',
        "      elif [[ ${COMP_CWORD} -eq 3 ]]; then",
        "        local tmpls=$(scaf templates --json 2>/dev/null | jq -r '.[].template' | sort -u);",
        '        COMPREPLY=( $(compgen -W "$tmpls" -- "$cur") ); return;',
        "      fi",
        "      ;;",
        "    update|regen|delete|ls|validate)",
        "      local targets=\"all $(scaf ls --json 2>/dev/null | jq -r '.[].path')\";",
        '      COMPREPLY=( $(compgen -W "$targets" -- "$cur") ); return;',
        "      ;;",
        "",
        "  esac",
        "}",
        "complete -F _scaf_complete scaf",
      ].join("\n"),
    );
    return;
  }
  if (shell === "zsh") {
    console.log(
      [
        "#compdef scaf",
        "_scaf_complete() {",
        `  local -a subs; subs=( ${subcommands} )`,
        "  if (( CURRENT == 2 )); then",
        "    _describe -t commands 'scaf subcommands' subs; return",
        "  fi",
        "  case $words[2] in",
        "    new)",
        "      if (( CURRENT == 3 )); then",
        "        compadd -- $(scaf __complete languages); return",
        "      elif (( CURRENT == 4 )); then",
        "        local lang=$words[3]",
        "        compadd -- $(scaf __complete templates $lang); return",
        "      fi",
        "      ;;",
        "    update|regen|delete|ls|validate)",
        "      compadd -- $(scaf __complete targets); return",
        "      ;;",
        "",
        "  esac",
        "}",
        "compdef _scaf_complete scaf",
      ].join("\n"),
    );
    return;
  }
  if (shell === "fish") {
    console.log(
      [
        "complete -c scaf -n '__fish_use_subcommand' -a 'templates'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'new'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'update'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'regen'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'delete'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'move'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'ls'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'help'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'validate'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'template'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'completions'",
        "complete -c scaf -n '__fish_seen_subcommand_from new; and test (count (commandline -opc)) -eq 2' -a '(scaf __complete languages)'",
        "complete -c scaf -n '__fish_seen_subcommand_from new; and test (count (commandline -opc)) -eq 3' -a '(set -l lang (commandline -opc | sed -n 2p); scaf __complete templates $lang)'",
        "complete -c scaf -n '__fish_seen_subcommand_from update regen delete ls validate' -a '(scaf __complete targets)'",
      ].join("\n"),
    );
    return;
  }
}

export async function completeLanguages(): Promise<void> {
  const metas = await readTemplateMeta(undefined, { tolerateStaleTaxonomy: true });
  const langs = Array.from(new Set(metas.map((m) => m.language))).sort();
  console.log(langs.join("\n"));
}

export async function completeTemplatesFor(lang: string): Promise<void> {
  const metas = await readTemplateMeta(lang, { tolerateStaleTaxonomy: true });
  const tmpls = metas.filter((m) => m.language === lang).map((m) => m.template);
  console.log(Array.from(new Set(tmpls)).sort().join("\n"));
}

export async function completeTargets(): Promise<void> {
  const rows = await discoverScaffolds(".");
  const lines = ["all", ...rows.map((r) => r.path)];
  console.log(lines.join("\n"));
}
