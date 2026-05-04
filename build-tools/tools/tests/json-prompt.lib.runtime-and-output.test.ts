#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPromptDefaults,
  completeJsonPromptObject,
  formatNamedArgsOutput,
  orderedPromptKeys,
  parseJsonPromptObject,
  parsePromptOptions,
  renderPromptText,
  resolvePromptResponse,
  shouldEmitNothingForRawInput,
} from "../json-prompt-lib";

test("json-prompt-lib: renders prompts with unix-style defaults from templates", () => {
  const inputObject = parseJsonPromptObject('{"configRoot":"/etc/nixos","configEntryPath":null}');
  const options = parsePromptOptions(
    [],
    inputObject,
    '{"labels":{"configEntryPath":"Config entry path"},"defaultTemplates":{"configEntryPath":"${configRoot}/configuration.nix"}}',
  );
  assert.equal(
    renderPromptText("configEntryPath", inputObject, options),
    "Config entry path [/etc/nixos/configuration.nix]: ",
  );
});

test("json-prompt-lib: typed template defaults can stay strings for numeric-looking values", () => {
  const inputObject = parseJsonPromptObject('{"accountSeed":"007","accountId":null}');
  const options = parsePromptOptions(
    [],
    inputObject,
    '{"fieldTypes":{"accountId":"string"},"defaultTemplates":{"accountId":"${accountSeed}"}}',
  );
  assert.equal(renderPromptText("accountId", inputObject, options), "accountId [007]: ");
  assert.deepEqual(resolvePromptResponse("accountId", "   ", inputObject, options), {
    kind: "set",
    value: "007",
  });
});

test("json-prompt-lib: resolves blank answers using defaults, templates, omission, and conditional required rules", () => {
  const inputObject = parseJsonPromptObject(
    '{"configRoot":"/etc/nixos","installMode":"managed-dropin","configEntryPath":null,"nickname":null}',
  );
  const options = parsePromptOptions(
    [],
    inputObject,
    '{"requiredWhen":[{"if":{"installMode":"managed-dropin"},"require":["configEntryPath"]}],"defaultTemplates":{"configEntryPath":"${configRoot}/configuration.nix"}}',
  );
  assert.deepEqual(resolvePromptResponse("configEntryPath", "   ", inputObject, options), {
    kind: "set",
    value: "/etc/nixos/configuration.nix",
  });
  assert.deepEqual(resolvePromptResponse("nickname", "   ", inputObject, options), {
    kind: "omit",
  });
});

test("json-prompt-lib: retries required fields without defaults", () => {
  const inputObject = parseJsonPromptObject('{"email":null}');
  const options = parsePromptOptions([], inputObject, '{"required":["email"]}');
  assert.deepEqual(resolvePromptResponse("email", "   ", inputObject, options), {
    kind: "retry",
    reason: "value is required",
  });
});

test("json-prompt-lib: applies defaults, templates, ordering, and omits empty optional fields in non-interactive mode", () => {
  const inputObject = parseJsonPromptObject(
    '{"configRoot":"","installMode":"","configEntryPath":null,"nickname":"","age":2}',
  );
  const options = parsePromptOptions(
    [],
    inputObject,
    '{"order":["configRoot","installMode","configEntryPath"],"required":["configRoot","installMode"],"defaults":{"configRoot":"/etc/nixos","installMode":"managed-dropin"},"requiredWhen":[{"if":{"installMode":"managed-dropin"},"require":["configEntryPath"]}],"defaultTemplates":{"configEntryPath":"${configRoot}/configuration.nix"}}',
  );
  assert.deepEqual(applyPromptDefaults(inputObject, options), {
    output: {
      configRoot: "/etc/nixos",
      installMode: "managed-dropin",
      configEntryPath: "/etc/nixos/configuration.nix",
      age: 2,
    },
    missingRequired: [],
  });
});

test("json-prompt-lib: rules can declare fields missing from the input object", async () => {
  const inputObject = parseJsonPromptObject("{}");
  const options = parsePromptOptions(
    [],
    inputObject,
    '{"order":["profileName","destination"],"required":["profileName","destination"],"defaults":{"profileName":"default"},"defaultTemplates":{"destination":"${profileName}"}}',
  );
  assert.deepEqual(await completeJsonPromptObject(inputObject, options, { interactive: false }), {
    profileName: "default",
    destination: "default",
  });
});

test("json-prompt-lib: ordered prompt keys respect rules order first", () => {
  const inputObject = parseJsonPromptObject(
    '{"destination":null,"profileName":null,"sshMode":null}',
  );
  const options = parsePromptOptions([], inputObject, '{"order":["profileName","destination"]}');
  assert.deepEqual(orderedPromptKeys(inputObject, options), [
    "profileName",
    "destination",
    "sshMode",
  ]);
});

test("json-prompt-lib: formats completed objects as named args", () => {
  assert.equal(
    formatNamedArgsOutput(parseJsonPromptObject('{"name":"Jane Doe","count":2,"enabled":true}')),
    "--name\nJane Doe\n--count\n2\n--enabled\ntrue",
  );
});

test("json-prompt-lib: formats boolean true values as bare flags when namedArgModes opt in", () => {
  assert.equal(
    formatNamedArgsOutput(parseJsonPromptObject('{"json":true,"verbose":false,"name":"demo"}'), {
      json: "flag",
      verbose: "flag",
    }),
    "--json\n--name\ndemo",
  );
});

test("json-prompt-lib: rejects non-boolean values for flag-style named args", () => {
  assert.throws(
    () => formatNamedArgsOutput(parseJsonPromptObject('{"json":"true"}'), { json: "flag" }),
    /must be boolean when namedArgModes\.json is "flag"/,
  );
});

test("json-prompt-lib: empty raw input is treated as empty stdout", () => {
  assert.equal(shouldEmitNothingForRawInput(""), true);
  assert.equal(shouldEmitNothingForRawInput(" \n\t "), true);
  assert.equal(shouldEmitNothingForRawInput("{}"), false);
});
