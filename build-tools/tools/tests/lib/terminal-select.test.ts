#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { promptTerminalSelect } from "../../lib/terminal-select";
import { CaptureOutput, FakeTtyInput, withTimeout } from "./terminal-select.fixture";

test("terminal selector pauses stdin after selection", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\u001b[B");
    input.write("\r\n");
    assert.equal(await selected, "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector accepts enter typed during initial render", async () => {
  const input = new FakeTtyInput();
  input.dropWritesWithoutDataListener = true;
  const output = new CaptureOutput(() => input.write("\r"));
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    assert.equal(await withTimeout(selected), "first");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector handles first arrow key typed during initial render", async () => {
  const input = new FakeTtyInput();
  input.dropWritesWithoutDataListener = true;
  const output = new CaptureOutput(() => input.write("\u001b[B"));
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\r");
    assert.equal(await withTimeout(selected), "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector handles split first arrow key bytes", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\u001b");
    input.write("[");
    input.write("B");
    input.write("\r");
    assert.equal(await selected, "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector rerenders from wrapped choice row count", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput(undefined, 12);
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First choice with a long label", value: "first-choice" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\u001b[B");
    input.write("\r");
    assert.equal(await selected, "second");
    assert.match(output.text, /\u001b\[6A/);
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector handles input emitted while resuming raw input", async () => {
  const input = new FakeTtyInput("\r");
  const output = new CaptureOutput();
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    assert.equal(await withTimeout(selected), "first");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector renders before resuming raw input", async () => {
  const input = new FakeTtyInput("\r");
  const output = new CaptureOutput();
  try {
    input.onResume = () => {
      assert.match(output.text, /Select item:  Up\/Down then Enter/);
      assert.match(output.text, /> First/);
    };
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    assert.equal(await withTimeout(selected), "first");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector enters raw mode before subscribing to data", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  try {
    input.assertRawBeforeDataListener = true;
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\r");
    assert.equal(await selected, "first");
    assert.equal(input.rawBeforeDataListenerChecked, true);
    assert.equal(input.dataListenerViaOnCount, 1);
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});
