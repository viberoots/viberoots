export function sprinklerefUsage() {
  return `Usage:
  sprinkleref --init <dir>
  sprinkleref --init-local
  sprinkleref --resolver-entry --add <category> --backend <kind> [backend options]
  sprinkleref --resolver-entry --update <category> --backend <kind> [backend options]
  sprinkleref --check [--scheme secret|config|runtime] [--format json]
  sprinkleref --get <secret://...> --fingerprint [--category <name>] [--format json]
  sprinkleref --add <secret://...> [--category <name>] [--value-env <name>|--value-file <path>]
  sprinkleref --update <secret://...> [--category <name>] [--value-env <name>|--value-file <path>]
  sprinkleref --remove <secret://...> [--category <name>] [--yes]

Options:
  --config <path>              Resolver config path
  --category <name>            Resolver category, defaults from config
  --overwrite-existing         Allow --add to replace an existing ref or resolver category
  --create-missing             Allow --update to create a missing ref or resolver category
  --check                      Inventory and validate deployment contract refs
  --fingerprint                Print only a digest for --get; secret values are never printed
  --target <buck-target>       Limit --check to structured refs required by a Buck target
  --dry-run                    Describe the selected backend without reading or writing values
  --init-local                 Create or update projects/config/local.json
`;
}
