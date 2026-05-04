#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractPromptRuleSource,
  mergeFlatPromptObjects,
  parseJsonPromptObject,
  parsePromptAnswer,
  parsePromptOptions,
  parsePromptRuleSet,
} from "../json-prompt-lib";

test("json-prompt-lib: parses a flat object with primitives", () => {
  assert.deepEqual(parseJsonPromptObject('{"name":"demo","count":2,"enabled":true,"note":null}'), {
    name: "demo",
    count: 2,
    enabled: true,
    note: null,
  });
});

test("json-prompt-lib: rejects nested objects", () => {
  assert.throws(
    () => parseJsonPromptObject('{"nested":{"x":1}}'),
    /must be a primitive JSON value or null/,
  );
});

test("json-prompt-lib: rejects arrays", () => {
  assert.throws(
    () => parseJsonPromptObject('{"items":[1,2,3]}'),
    /must be a primitive JSON value or null/,
  );
});

test("json-prompt-lib: parses JSON primitives from answers", () => {
  assert.equal(parsePromptAnswer("42"), 42);
  assert.equal(parsePromptAnswer("true"), true);
  assert.equal(parsePromptAnswer('"hello"'), "hello");
});

test("json-prompt-lib: can force field answers to stay strings", () => {
  assert.equal(parsePromptAnswer("007", "string"), "007");
  assert.equal(parsePromptAnswer("42", "string"), "42");
});

test("json-prompt-lib: can force typed answers for numbers and booleans", () => {
  assert.equal(parsePromptAnswer("42", "number"), 42);
  assert.equal(parsePromptAnswer("true", "boolean"), true);
  assert.throws(() => parsePromptAnswer("abc", "number"), /expected a number/);
  assert.throws(() => parsePromptAnswer("yes", "boolean"), /expected a boolean/);
});

test("json-prompt-lib: falls back to plain strings for unquoted answers", () => {
  assert.equal(parsePromptAnswer("foo@example.com"), "foo@example.com");
});

test("json-prompt-lib: rejects blank answers", () => {
  assert.throws(() => parsePromptAnswer("   "), /value is required/);
});

test("json-prompt-lib: extracts inline rules and removes rule flags from argv", async () => {
  const extracted = await extractPromptRuleSource([
    "--rules",
    '{"required":["name"]}',
    "--name",
    "Full name",
  ]);
  assert.equal(extracted.rulesRaw, '{"required":["name"]}');
  assert.deepEqual(extracted.optionArgs, ["--name", "Full name"]);
});

test("json-prompt-lib: extracts rules from file", async () => {
  const extracted = await extractPromptRuleSource(
    ["--rules-file", "/tmp/rules.json", "--name", "Full name"],
    async (filePath) => {
      assert.equal(filePath, "/tmp/rules.json");
      return '{"labels":{"name":"Configured name"}}';
    },
  );
  assert.equal(extracted.rulesRaw, '{"labels":{"name":"Configured name"}}');
  assert.deepEqual(extracted.optionArgs, ["--name", "Full name"]);
});

test("json-prompt-lib: parses reserved help flags as field mappings from rules", () => {
  assert.deepEqual(parsePromptRuleSet('{"reservedFlagsAsFields":{"--help":"help","-h":"h"}}'), {
    reservedFlagsAsFields: {
      "--help": "help",
      "-h": "h",
    },
  });
});

test("json-prompt-lib: parses field types from rules", () => {
  assert.deepEqual(
    parsePromptRuleSet('{"fieldTypes":{"accountId":"string","enabled":"boolean"}}'),
    {
      fieldTypes: {
        accountId: "string",
        enabled: "boolean",
      },
    },
  );
});

test("json-prompt-lib: parses named-arg modes from rules", () => {
  assert.deepEqual(parsePromptRuleSet('{"namedArgModes":{"json":"flag","name":"pair"}}'), {
    namedArgModes: {
      json: "flag",
      name: "pair",
    },
  });
});

test("json-prompt-lib: merges rules with legacy labels, defaults, and required fields", () => {
  const inputObject = parseJsonPromptObject('{"name":null,"email":null,"age":30}');
  const options = parsePromptOptions(
    ["--name", "Full name", "--email=Email address", "--default-name=Guest", "--required", "email"],
    inputObject,
    '{"order":["email","name"],"labels":{"name":"Configured name"},"required":["name"]}',
  );
  assert.deepEqual(options.order, ["email", "name"]);
  assert.deepEqual(options.labels, {
    name: "Full name",
    email: "Email address",
  });
  assert.deepEqual(options.defaults, { name: "Guest" });
  assert.deepEqual(Array.from(options.required).sort(), ["email", "name"]);
});

test("json-prompt-lib: legacy defaults respect rule-declared field types", () => {
  const inputObject = parseJsonPromptObject('{"accountId":null}');
  const options = parsePromptOptions(
    ["--default-accountId", "007"],
    inputObject,
    '{"fieldTypes":{"accountId":"string"}}',
  );
  assert.deepEqual(options.defaults, { accountId: "007" });
});

test("json-prompt-lib: mergeFlatPromptObjects applies later-source precedence and normalizes blanks", () => {
  assert.deepEqual(
    mergeFlatPromptObjects(
      { profileName: "mini", destination: "", sshMode: "ssh" },
      { destination: "target", sshMode: " " },
    ),
    {
      profileName: "mini",
      destination: "target",
      sshMode: null,
    },
  );
});

test("json-prompt-lib: legacy prompt options can declare fields absent from the seed object", () => {
  const inputObject = parseJsonPromptObject('{"name":null}');
  const options = parsePromptOptions(
    ["--email", "Email address", "--required", "email", "--default-email", "guest@example.com"],
    inputObject,
  );
  assert.equal(options.labels.email, "Email address");
  assert.equal(options.defaults.email, "guest@example.com");
  assert.equal(options.required.has("email"), true);
  assert.equal(options.fieldKeys.includes("email"), true);
});

test("json-prompt-lib: reserved help flags can be interpreted as field label options", () => {
  const inputObject = parseJsonPromptObject("{}");
  const options = parsePromptOptions(
    ["--help", "Detailed help text", "-h", "Short help text"],
    inputObject,
    '{"reservedFlagsAsFields":{"--help":"help","-h":"h"}}',
  );
  assert.equal(options.labels.help, "Detailed help text");
  assert.equal(options.labels.h, "Short help text");
  assert.equal(options.fieldKeys.includes("help"), true);
  assert.equal(options.fieldKeys.includes("h"), true);
});

test("json-prompt-lib: rejects malformed prompt options", () => {
  const inputObject = parseJsonPromptObject('{"name":null}');
  assert.throws(
    () => parsePromptOptions(["name"], inputObject),
    /expected --field label, --field=label, --required field, or --default-field value/,
  );
  assert.throws(() => parsePromptOptions(["--name"], inputObject), /must not be empty/);
  assert.throws(() => parsePromptOptions(["--name="], inputObject), /must not be empty/);
  assert.throws(() => parsePromptOptions(["--required"], inputObject), /must not be empty/);
  assert.throws(
    () => parsePromptOptions(["--default-name="], inputObject),
    /default value for "name" must not be empty/,
  );
});

test("json-prompt-lib: rejects invalid rules", () => {
  const inputObject = parseJsonPromptObject(
    '{"name":null,"installMode":null,"configEntryPath":null}',
  );
  assert.throws(
    () =>
      parsePromptOptions(
        [],
        inputObject,
        '{"requiredWhen":[{"if":{"installMode":null},"require":["configEntryPath"]}]}',
      ),
    /must be a non-null primitive/,
  );
  assert.throws(
    () => parsePromptRuleSet('{"fieldTypes":{"accountId":"uuid"}}'),
    /must be string, number, or boolean/,
  );
  assert.throws(
    () => parsePromptRuleSet('{"fieldTypes":{"accountId":"string"},"defaults":{"accountId":7}}'),
    /must be a string/,
  );
  assert.throws(
    () => parsePromptRuleSet('{"namedArgModes":{"json":"switch"}}'),
    /must be pair or flag/,
  );
  assert.throws(
    () => parsePromptRuleSet('{"fieldTypes":{"json":"string"},"namedArgModes":{"json":"flag"}}'),
    /cannot be flag unless fieldTypes\.json is boolean/,
  );
});
