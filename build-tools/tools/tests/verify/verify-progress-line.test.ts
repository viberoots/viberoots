import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createVerifyProgressReporter,
  formatVerifyProgressLine,
  formatVerifyProgressLines,
} from "../../dev/verify/progress-line";
import { captureProgressStream } from "./verify-progress-line.fixture";

test("verify progress line starts with test-count progress and elapsed time", () => {
  const line = formatVerifyProgressLine({
    name: "shared",
    completed: 0,
    failed: 0,
    total: 10,
    elapsedMs: 5_000,
    status: "running",
  });

  assert.match(line, /^  test\s+shared/);
  assert.doesNotMatch(line, /^  run\s+tests/);
  assert.match(line, /\[░{24}\] 0\/10 running 5s$/);
});

test("verify progress line switches to projected time once completions exist", () => {
  const line = formatVerifyProgressLine({
    name: "shared",
    completed: 5,
    failed: 1,
    total: 10,
    elapsedMs: 60_000,
    status: "running",
  });

  assert.match(line, /\[████████████░{12}\] 5\/10 fail 1 running 1:00 \/ ~2:00$/);
});

test("verify progress lines render every pass group including pending groups", () => {
  const lines = formatVerifyProgressLines([
    {
      name: "isolated",
      completed: 8,
      failed: 0,
      total: 8,
      elapsedMs: 209_000,
      status: "done",
    },
    {
      name: "isolated-bounded",
      completed: 0,
      failed: 0,
      total: 15,
      elapsedMs: 0,
      status: "pending",
    },
    {
      name: "shared",
      completed: 0,
      failed: 0,
      total: 1400,
      elapsedMs: 0,
      status: "pending",
    },
  ]);

  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^  test\s+isolated\s+\[█{24}\] 8\/8 done 3:29$/);
  assert.match(lines[1]!, /^  test\s+isolated-bounded \[░{24}\] 0\/15 pending 0s$/);
  assert.match(lines[2]!, /^  test\s+shared\s+\[░{24}\] 0\/1400 pending 0s$/);
});

test("verify progress colors match verify status color policy", () => {
  const done = formatVerifyProgressLine(
    { name: "shared", completed: 1, failed: 0, total: 1, elapsedMs: 1000, status: "done" },
    { color: true },
  );
  const failed = formatVerifyProgressLine(
    { name: "shared", completed: 1, failed: 1, total: 1, elapsedMs: 1000, status: "failed" },
    { color: true },
  );

  assert.match(done, /\u001b\[36mtest\u001b\[0m/);
  assert.match(done, /\u001b\[32mshared/);
  assert.match(failed, /\u001b\[31mshared/);
});

test("verify progress reporter freezes completed pass elapsed time", () => {
  let now = 0;
  const { stream, writes } = captureProgressStream(true);
  const reporter = createVerifyProgressReporter({
    enabled: true,
    passes: [{ name: "isolated", total: 1 }],
    now: () => now,
    stream,
    env: { TERM: "xterm-256color" },
  });

  reporter.start();
  reporter.update("isolated", { status: "running" });
  now = 1_000;
  reporter.update("isolated", { completed: 1 });
  now = 2_000;
  reporter.update("isolated", { status: "done" });
  now = 10_000;
  reporter.update("isolated", { completed: 1 });
  reporter.stop({ clear: false });

  const output = writes.join("");
  assert.match(output, /1\/1 done 2s/);
  assert.doesNotMatch(output, /1\/1 done 2s \/ ~/);
  assert.doesNotMatch(output, /1\/1 done 10s/);
});

test("verify progress reporter stays silent for empty target selections", () => {
  const { stream, writes } = captureProgressStream(false);
  const reporter = createVerifyProgressReporter({
    enabled: true,
    passes: [],
    stream,
  });

  reporter.start();
  reporter.stop({ clear: false });

  assert.deepEqual(writes, []);
});

test("verify progress reporter redraws tty output from column zero", () => {
  const { stream, writes } = captureProgressStream(true);
  const reporter = createVerifyProgressReporter({
    enabled: true,
    passes: [{ name: "isolated", total: 8 }],
    stream,
    env: { TERM: "xterm-256color" },
  });

  reporter.start();
  reporter.update("isolated", { status: "running", completed: 6 });
  reporter.stop();

  const output = writes.join("");
  assert.match(output, /\r\u001b\[1A\r\u001b\[J/);
  assert.doesNotMatch(output, /[^\r]\u001b\[1A\u001b\[J/);
});

test("verify progress reporter renders successful passes complete", () => {
  let now = 0;
  const { stream, writes } = captureProgressStream(true);
  const reporter = createVerifyProgressReporter({
    enabled: true,
    passes: [{ name: "shared", total: 1505 }],
    now: () => now,
    stream,
    env: { TERM: "xterm-256color" },
  });

  reporter.start();
  reporter.update("shared", { status: "running" });
  now = 3_900_000;
  reporter.update("shared", { completed: 1499 });
  now = 3_910_000;
  reporter.update("shared", { status: "done" });
  reporter.stop({ clear: false });

  const output = writes.join("");
  assert.match(output, /1505\/1505 done 1:05:10/);
  assert.doesNotMatch(output, /1499\/1505 done/);
});

test("verify progress reporter redraws in Codex cmux TTY terminals", () => {
  let now = 0;
  const { stream, writes } = captureProgressStream(true);
  const reporter = createVerifyProgressReporter({
    enabled: true,
    passes: [{ name: "isolated", total: 1 }],
    now: () => now,
    stream,
    env: {
      TERM: "xterm-256color",
      CODEX_CI: "1",
      CMUX_WORKSPACE_ID: "workspace",
      NO_COLOR: "1",
    },
  });

  reporter.start();
  reporter.update("isolated", { status: "running" });
  now = 39_000;
  reporter.update("isolated", { completed: 1, status: "done" });
  reporter.stop({ clear: false });

  const output = writes.join("");
  assert.match(output, /\r\u001b\[1A\r\u001b\[J/);
  assert.match(output, /1\/1 done 39s/);
});

test("verify progress reporter only prints changed passes for non-tty output", () => {
  const { stream, writes } = captureProgressStream(false);
  const reporter = createVerifyProgressReporter({
    enabled: true,
    passes: [
      { name: "isolated", total: 9 },
      { name: "enforcement", total: 45 },
      { name: "shared", total: 1494 },
    ],
    now: () => 7_000,
    stream,
    env: {
      TERM: "xterm-256color",
      CODEX_CI: "1",
      CMUX_WORKSPACE_ID: "workspace",
      NO_COLOR: "1",
    },
  });

  reporter.start();
  reporter.update("isolated", { status: "running" });
  reporter.update("enforcement", { completed: 45, status: "done" });
  reporter.stop({ clear: false });

  const output = writes.join("");
  assert.match(output, /isolated\s+\[░{24}\] 0\/9 running 0s/);
  assert.match(output, /enforcement \[█{24}\] 45\/45 done 0s/);
  assert.doesNotMatch(output, /shared\s+\[░{24}\] 0\/1494 pending/);
  assert.equal(output.match(/^  test/gm)?.length, 2);
});
