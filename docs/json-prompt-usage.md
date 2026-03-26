# `json-prompt` Usage

`json-prompt` fills in missing values in a flat JSON object.

It accepts only a top-level object whose values are JSON primitives:

- string
- number
- boolean
- `null`

Nested objects and arrays are rejected.

## Quick Start

Pass JSON as the first argument:

```bash
json-prompt '{"name":null,"email":null,"age":30}'
```

Or pass JSON on stdin:

```bash
printf '%s\n' '{"name":null,"email":null,"age":30}' | json-prompt
```

Existing non-null values pass through unchanged. Missing or empty values are the
ones that get resolved.

## Help

Print the built-in usage string:

```bash
json-prompt help
```

By default, `--help` and `-h` also work.
If those flags collide with field names, see
[`reservedFlagsAsFields`](#reserved-help-flag-collisions).

## Input Rules

- The input object must be flat.
- Empty stdin produces empty stdout.
- Whitespace-only values from prompt answers and prompt/default flags are treated as empty.
- Raw JSON input values are preserved as provided.

## Output Modes

Default JSON output:

```bash
json-prompt '{"name":"Jane Doe","count":2,"enabled":true}'
```

Named-args output:

```bash
json-prompt --output=named-args '{"name":"Jane Doe","count":2,"enabled":true}'
```

Space-separated form also works:

```bash
json-prompt --output named-args '{"name":"Jane Doe","count":2,"enabled":true}'
```

That renders alternating tokens like:

```text
--name
Jane Doe
--count
2
--enabled
true
```

This is designed for shell expansion into another command:

```bash
args=("${(@f)$(json-prompt --output=named-args < input.json)}")
some-command "${args[@]}"
```

This variant is covered by tests that verify the output is split into separate
arguments and can control downstream flag-driven behavior.

### Bare-Flag Named Args

By default, named-args output uses `--field value` pairs.

Rules can opt specific boolean fields into bare-flag rendering with
`namedArgModes`:

```bash
json-prompt --output=named-args \
  --rules '{"fieldTypes":{"json":"boolean"},"namedArgModes":{"json":"flag"}}' \
  '{"json":true,"name":"demo"}'
```

Output:

```text
--json
--name
demo
```

Behavior:

- `pair` keeps the default `--field value` form
- `flag` emits only `--field` when the field value is `true`
- `flag` emits nothing for `false`, `null`, or omitted values
- `flag` requires the field to be boolean

## Field Labels

Use named flags to change prompt labels.

Space-separated form:

```bash
json-prompt '{"name":null}' --name "Full name"
```

Equals form:

```bash
json-prompt '{"email":null}' --email="Email address"
```

These flags are named after the JSON field, so order does not matter.

## Required Fields

Mark fields as required with:

```bash
json-prompt '{"email":null}' --required email
```

Or:

```bash
json-prompt '{"email":null}' --required=email
```

Behavior:

- blank required answer with no default: prompt repeats
- missing required field in non-interactive mode: command fails

## Default Values

Set defaults with:

```bash
json-prompt '{"name":null}' --default-name Guest
```

Or:

```bash
json-prompt '{"name":null}' --default-name="Guest"
```

Default values are parsed as JSON primitives when possible.

Examples:

```bash
json-prompt '{"count":null}' --default-count 2
json-prompt '{"enabled":null}' --default-enabled true
json-prompt '{"name":null}' --default-name '"Jane Doe"'
```

Behavior:

- blank answer with a default: uses the default
- blank optional answer with no default: field is omitted from output

## Rules

Rules can be passed inline or from a file.

Supported rule fields:

- `order`
- `labels`
- `required`
- `defaults`
- `fieldTypes`
- `namedArgModes`
- `requiredWhen`
- `defaultTemplates`
- `reservedFlagsAsFields`

### Inline Rules

```bash
json-prompt '{"name":null,"email":null}' \
  --rules '{"order":["email","name"],"required":["email"],"labels":{"name":"Full name"}}'
```

Equals form also works:

```bash
json-prompt '{"name":null,"email":null}' \
  --rules='{"order":["email","name"],"required":["email"],"labels":{"name":"Full name"}}'
```

### Rules File

```bash
json-prompt --rules-file /tmp/rules.json < input.json
```

Equals form also works:

```bash
json-prompt --rules-file=/tmp/rules.json < input.json
```

Example rules file:

```json
{
  "order": ["configRoot", "installMode", "configEntryPath"],
  "labels": {
    "configEntryPath": "Config entry path"
  },
  "required": ["configRoot", "installMode"],
  "defaults": {
    "configRoot": "/etc/nixos",
    "installMode": "managed-dropin"
  },
  "fieldTypes": {
    "configRoot": "string"
  },
  "namedArgModes": {
    "json": "flag"
  },
  "requiredWhen": [
    {
      "if": { "installMode": "managed-dropin" },
      "require": ["configEntryPath"]
    }
  ],
  "defaultTemplates": {
    "configEntryPath": "${configRoot}/configuration.nix"
  }
}
```

## Forced Field Types

Use `fieldTypes` in rules when a value should be interpreted as a specific type
instead of relying on the default JSON-primitive auto-parse behavior.

Supported field types:

- `string`
- `number`
- `boolean`

Example: preserve a numeric-looking value as a string:

```bash
json-prompt '{"accountId":null}' \
  --rules '{"fieldTypes":{"accountId":"string"}}' \
  --default-accountId 007
```

Output:

```json
{
  "accountId": "007"
}
```

Example: require a prompted value to be numeric:

```bash
json-prompt '{"port":null}' \
  --rules '{"fieldTypes":{"port":"number"},"required":["port"]}'
```

Behavior:

- `string` preserves the entered text as a string
- `number` requires a valid JSON number
- `boolean` requires `true` or `false`
- rule defaults must match the declared type
- template defaults are coerced through the declared type

## Reserved Help-Flag Collisions

By default:

- `json-prompt help`
- `json-prompt --help`
- `json-prompt -h`

print usage text.

If your field names collide with those flags, rules can explicitly remap them as
field options:

```bash
json-prompt '{"help":null,"h":null}' \
  --rules '{"reservedFlagsAsFields":{"--help":"help","-h":"h"}}' \
  --help "Detailed help text" \
  -h "Short help text"
```

Output:

```json
{
  "help": "Detailed help text",
  "h": "Short help text"
}
```

This keeps help available by default while still allowing explicit opt-in for
colliding field names.

## Conditional Requirements

Use `requiredWhen` in rules to make one field depend on another:

```bash
json-prompt '{"installMode":"managed-dropin","configEntryPath":null}' \
  --rules '{"requiredWhen":[{"if":{"installMode":"managed-dropin"},"require":["configEntryPath"]}]}'
```

## Template Defaults

Use `defaultTemplates` in rules to derive one field from another:

```bash
json-prompt '{"configRoot":"/etc/nixos","configEntryPath":null}' \
  --rules '{"defaultTemplates":{"configEntryPath":"${configRoot}/configuration.nix"}}'
```

When a template can be fully resolved, the prompt shows the default in Unix
style:

```text
Config entry path [/etc/nixos/configuration.nix]:
```

## Non-Interactive Behavior

In non-interactive mode, `json-prompt` does not try to ask questions. Instead it:

- applies explicit defaults
- applies template defaults when they can be resolved
- omits empty optional fields
- fails on unresolved required fields

Example:

```bash
printf '%s\n' '{"profileName":null,"destination":null}' | \
  json-prompt --rules '{"required":["profileName","destination"],"defaults":{"profileName":"default"},"defaultTemplates":{"destination":"${profileName}"}}'
```

Output:

```json
{
  "profileName": "default",
  "destination": "default"
}
```

## Variants Covered by Tests

The current test suite covers these usage variants:

- JSON input as the first argument
- JSON input from stdin
- empty stdin emits empty stdout
- field labels with `--field value`
- field labels with `--field=value`
- required fields with `--required value`
- defaults with `--default-field value`
- defaults with `--default-field=value`
- inline rules with `--rules`
- rules file loading with `--rules-file`
- forced field types via `fieldTypes`
- bare-flag named-args via `namedArgModes`
- conditional requirements via `requiredWhen`
- template defaults via `defaultTemplates`
- reserved help-flag remapping via `reservedFlagsAsFields`
- named-args output expansion into another command
- named-args output driving downstream command behavior
- `help` subcommand output
