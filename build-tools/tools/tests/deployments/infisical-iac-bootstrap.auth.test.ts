#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  createSpawnCommandRunner,
  getAccessToken,
  spawnCommandRunner,
} from "../../deployments/infisical-iac-bootstrap-auth";
import {
  orgIdByExactName,
  organizationListReason,
  resolveOrganizationId,
} from "../../deployments/infisical-iac-bootstrap-org";
import type { CommandRunner } from "../../deployments/infisical-iac-bootstrap-types";

test("organization exact-name selection and non-interactive remediation include org names", () => {
  const orgs = [
    { id: "org_1", name: "viberoots" },
    { id: "org_2", name: "personal" },
  ];
  assert.equal(orgIdByExactName(orgs, "viberoots"), "org_1");
  assert.match(organizationListReason(orgs), /viberoots \(org_1\)/);
  assert.match(organizationListReason(orgs), /personal \(org_2\)/);
  assert.throws(() => orgIdByExactName(orgs, "missing"), /no accessible/);
});

test("login-based organization selection auto-selects one accessible org with --yes", async () => {
  const api = fakeOrgApi([{ id: "org_1", name: "viberoots" }]);
  const orgId = await resolveOrganizationId(api as never, { ...DEFAULT_BOOTSTRAP_ARGS, yes: true });
  assert.equal(orgId, "org_1");
});

test("organization selection accepts an interactive numbered choice", async () => {
  const api = fakeOrgApi([
    { id: "org_1", name: "personal" },
    { id: "org_2", name: "viberoots" },
  ]);
  const orgId = await resolveOrganizationId(api as never, DEFAULT_BOOTSTRAP_ARGS, {
    stdin: { isTTY: true } as NodeJS.ReadStream,
    stdout: { isTTY: true } as NodeJS.WriteStream,
    question: async () => "2",
  });
  assert.equal(orgId, "org_2");
});

test("organization selection fails non-interactively with org names and remediation", async () => {
  const api = fakeOrgApi([
    { id: "org_1", name: "personal" },
    { id: "org_2", name: "viberoots" },
  ]);
  await assert.rejects(
    () =>
      resolveOrganizationId(api as never, DEFAULT_BOOTSTRAP_ARGS, {
        stdin: { isTTY: false } as NodeJS.ReadStream,
        stdout: { isTTY: false } as NodeJS.WriteStream,
      }),
    /personal \(org_1\)[\s\S]*viberoots \(org_2\)[\s\S]*--org-name or --organization-id/,
  );
});

test("CLI login uses isolated HOME and removes local state after token extraction", async () => {
  let observedHome = "";
  let observedUpdateCheck = "";
  const commands: string[] = [];
  const captures: Array<boolean | undefined> = [];
  const ttys: Array<boolean | undefined> = [];
  const runner: CommandRunner = ({ args, env, capture, tty }) => {
    observedHome = String(env?.HOME || "");
    observedUpdateCheck = String(env?.INFISICAL_DISABLE_UPDATE_CHECK || "");
    commands.push(args.join(" "));
    captures.push(capture);
    ttys.push(tty);
    if (args.includes("login")) return "";
    return "human-token\n";
  };
  const output = await captureStderr(async () => {
    const result = await getAccessToken({ ...DEFAULT_BOOTSTRAP_ARGS }, runner, {});
    assert.equal(result.token, "human-token");
  });
  assert.match(observedHome, /infisical-iac-bootstrap-home-/);
  assert.equal(observedUpdateCheck, "true");
  assert.equal(commands[0], "vault set file --domain https://app.infisical.com/api --silent");
  assert.equal(captures[0], true);
  assert.deepEqual(ttys, [undefined, true, undefined]);
  assert.match(output, /waiting for Infisical CLI browser login/);
  assert.match(output, /wrong browser opens or no browser tab opens/);
  assert.match(output, /--infisical-login-mode interactive/);
  assert.match(output, /token-based automation/);
  assert.match(output, /Infisical CLI login complete/);
  await assert.rejects(() => fs.stat(observedHome), /ENOENT/);
});

test("CLI login supports command-line interactive mode when browser login is unsuitable", async () => {
  const commands: string[] = [];
  const ttys: Array<boolean | undefined> = [];
  const runner: CommandRunner = ({ args, tty }) => {
    commands.push(args.join(" "));
    ttys.push(tty);
    if (args.includes("login")) return "";
    return "human-token\n";
  };
  const output = await captureStderr(async () => {
    const result = await getAccessToken(
      { ...DEFAULT_BOOTSTRAP_ARGS, loginMode: "interactive" },
      runner,
      {},
    );
    assert.equal(result.token, "human-token");
  });
  assert.ok(
    commands.includes("login --domain https://app.infisical.com/api --interactive"),
    "interactive login mode must pass --interactive to the Infisical CLI",
  );
  assert.deepEqual(ttys, [undefined, true, undefined]);
  assert.match(output, /command-line Infisical login/);
});

test("interactive command runner restores tty mode after command failure", () => {
  const calls: string[] = [];
  const runner = createSpawnCommandRunner({
    openSync: () => 19,
    closeSync: (fd) => calls.push(`close ${fd}`),
    spawnSync: ((command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "stty" && args[0] === "-g") {
        return { status: 0, stdout: "saved-tty-mode\n" };
      }
      if (command === "stty") return { status: 0, stdout: "" };
      return { status: 130, stdout: "", stderr: "interrupted" };
    }) as never,
  });
  assert.throws(
    () => runner({ command: "infisical", args: ["login"], tty: true }),
    /infisical login failed with exit 130/,
  );
  assert.deepEqual(calls, ["stty -g", "infisical login", "stty saved-tty-mode", "close 19"]);
});

test("interactive command runner pauses parent stdin before child owns tty", () => {
  const originalStdin = process.stdin;
  const input = new FakeTtyInput();
  const runner = createSpawnCommandRunner({
    openSync: () => 19,
    closeSync: () => undefined,
    spawnSync: ((command: string, args: string[]) => {
      if (command === "stty") return { status: 0, stdout: args[0] === "-g" ? "mode\n" : "" };
      assert.equal(input.paused, true);
      return { status: 0, stdout: "", stderr: "" };
    }) as never,
  });
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  try {
    runner({ command: "infisical", args: ["login"], tty: true });
    assert.equal(input.paused, true);
  } finally {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    input.destroy();
  }
});

test("browser login explains empty token prompt failures", async () => {
  const runner: CommandRunner = ({ args }) => {
    if (args.includes("login")) {
      throw new Error(
        "infisical login failed: Invalid user credentials provided unexpected end of JSON input",
      );
    }
    return "";
  };
  await assert.rejects(
    () => getAccessToken({ ...DEFAULT_BOOTSTRAP_ARGS }, runner, {}),
    /Infisical browser login did not complete[\s\S]*do not press Enter[\s\S]*--infisical-login-mode interactive/,
  );
});

test("--no-login fails fast when the configured env var is missing", async () => {
  await assert.rejects(
    () => getAccessToken({ ...DEFAULT_BOOTSTRAP_ARGS, noLogin: true }, () => "", {}),
    /missing Infisical access token env var/,
  );
});

test("missing Infisical CLI reports install and token alternatives", () => {
  assert.throws(
    () =>
      spawnCommandRunner({
        command: "infisical",
        args: ["login"],
        env: { PATH: "" },
        capture: true,
      }),
    /Infisical CLI was not found[\s\S]*--infisical-bin[\s\S]*--no-login/,
  );
});

function fakeOrgApi(orgs: Array<{ id: string; name: string }>) {
  return { request: async () => ({ organizations: orgs }) };
}

class FakeTtyInput extends PassThrough {
  isTTY = true;
  paused = false;

  pause() {
    this.paused = true;
    return super.pause();
  }
}

async function captureStderr(fn: () => Promise<void>) {
  const originalWrite = process.stderr.write;
  let output = "";
  process.stderr.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = originalWrite;
  }
  return output;
}
