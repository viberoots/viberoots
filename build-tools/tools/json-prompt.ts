import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import { getArgvTokens } from "./lib/cli";
import {
  completeJsonPromptObject,
  extractPromptRuleSource,
  formatNamedArgsOutput,
  parseJsonPromptObject,
  parsePromptOptions,
  parsePromptRuleSet,
  shouldEmitNothingForRawInput,
  type JsonPromptOutputMode,
} from "./json-prompt-lib";

const USAGE = `Usage:
  json-prompt <json-object> [options]
  json-prompt [options] < input.json
  json-prompt help

Input:
  Accepts a flat JSON object with only primitive values or null.
  Existing non-null values pass through unchanged.
  Only missing or empty values are resolved.

Options:
  --output json|named-args
      Select the output format. Defaults to json.

  --rules <json>
      Inline rules object. Supports:
        order
        labels
        required
        defaults
        fieldTypes
        namedArgModes
        requiredWhen
        defaultTemplates

  --rules-file <path>
      Load the same rules object from a file.

  Rules can also declare reserved flags as field labels:
      "reservedFlagsAsFields": { "--help": "help", "-h": "h" }
      When present, those flags are treated as field options instead of help.

  --<field> <label>
  --<field>=<label>
      Set the prompt label for a field.

  --required <field>
  --required=<field>
      Mark a field as required.

  --default-<field> <value>
  --default-<field>=<value>
      Set a default value for a field. Values are parsed as JSON primitives when possible.

Behavior:
  Blank required answers without defaults are retried.
  Blank answers with defaults use the default.
  Blank optional answers without defaults are omitted from output.
  fieldTypes can force values to stay strings or require numbers/booleans.
  namedArgModes can emit boolean true values as bare flags in named-args mode.
  In non-interactive mode, defaults are applied and unresolved required fields fail closed.
  Empty stdin produces empty stdout.

Examples:
  json-prompt '{"name":null,"email":null}' --name "Full name" --required email

  json-prompt '{"configRoot":"/etc/nixos","configEntryPath":null}' \\
    --rules '{"requiredWhen":[{"if":{"installMode":"managed-dropin"},"require":["configEntryPath"]}],"defaultTemplates":{"configEntryPath":"\${configRoot}/configuration.nix"}}'

  json-prompt --rules-file /tmp/rules.json < input.json

  args=("\${(@f)\$(json-prompt --output=named-args < input.json)}")
  some-command "\${args[@]}"
`;

function extractOutputMode(argv: string[]): {
  optionArgs: string[];
  outputMode: JsonPromptOutputMode;
} {
  const optionArgs: string[] = [];
  let outputMode: JsonPromptOutputMode = "json";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--output" || arg.startsWith("--output=")) {
      const separatorIndex = arg.indexOf("=");
      const value =
        separatorIndex >= 0 ? arg.slice(separatorIndex + 1).trim() : (argv[index + 1] || "").trim();
      if (!value) throw new Error("output mode must not be empty");
      if (value !== "json" && value !== "named-args") {
        throw new Error(`unsupported output mode "${value}"`);
      }
      outputMode = value;
      if (separatorIndex < 0) index += 1;
      continue;
    }
    optionArgs.push(arg);
  }

  return { optionArgs, outputMode };
}

async function readInput(argv: string[]): Promise<string> {
  const argInput = argv[0]?.trim();
  if (argInput && !argInput.startsWith("-")) return argInput;

  if (process.stdin.isTTY) {
    throw new Error("expected JSON input from stdin or as the first argument");
  }

  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");

  return await new Promise<string>((resolve, reject) => {
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
      if (error) {
        reject(error);
        return;
      }
      resolve(chunks.join(""));
    };

    const onData = (chunk: string) => chunks.push(chunk);
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);

    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

async function main() {
  const argv = getArgvTokens();
  if (argv[0] === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const rawOptionArgsForRuleScan =
    argv[0]?.trim() && !argv[0].trim().startsWith("-") ? argv.slice(1) : argv;
  const { optionArgs: ruleScanArgs, rulesRaw: scannedRulesRaw } =
    await extractPromptRuleSource(rawOptionArgsForRuleScan);
  const scannedRules = parsePromptRuleSet(scannedRulesRaw);
  const reservedHelpFlags = new Set(Object.keys(scannedRules.reservedFlagsAsFields || {}));
  if (
    (argv.includes("--help") && !reservedHelpFlags.has("--help")) ||
    (argv.includes("-h") && !reservedHelpFlags.has("-h"))
  ) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const raw = await readInput(argv);
  if (shouldEmitNothingForRawInput(raw)) return;
  const inputObject = parseJsonPromptObject(raw);
  const rawOptionArgs = argv[0]?.trim() && !argv[0].trim().startsWith("-") ? argv.slice(1) : argv;
  const { optionArgs: withoutOutput, outputMode } = extractOutputMode(rawOptionArgs);
  const { optionArgs, rulesRaw } = await extractPromptRuleSource(withoutOutput);
  const promptOptions = parsePromptOptions(optionArgs, inputObject, rulesRaw);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const rl = interactive ? readline.createInterface({ input, output }) : null;
  try {
    const completedObject = await completeJsonPromptObject({ ...inputObject }, promptOptions, {
      interactive,
      prompt: rl ? (text) => rl.question(text) : undefined,
      onRetry: (reason) => console.error(reason),
    });
    if (outputMode === "named-args") {
      const rendered = formatNamedArgsOutput(completedObject, promptOptions.namedArgModes);
      if (rendered) process.stdout.write(`${rendered}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(completedObject, null, 2)}\n`);
  } finally {
    rl?.close();
  }
}

await main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
