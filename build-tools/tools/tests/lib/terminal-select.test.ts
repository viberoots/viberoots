#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { promptTerminalSelect } from "../../lib/terminal-select";

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
    assert.equal(await selected, "first");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector handles first arrow key typed during initial render", async () => {
  const input = new FakeTtyInput();
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
    assert.equal(await selected, "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

class FakeTtyInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  paused = true;
  rawMode = false;

  setRawMode(value: boolean) {
    this.isRaw = value;
    this.rawMode = value;
    return this;
  }

  resume() {
    this.paused = false;
    return super.resume();
  }

  pause() {
    this.paused = true;
    return super.pause();
  }

  isPaused() {
    return this.paused;
  }
}

class CaptureOutput extends Writable {
  isTTY = true;
  private wrote = false;
  private readonly onFirstWrite?: () => void;

  constructor(onFirstWrite?: () => void) {
    super();
    this.onFirstWrite = onFirstWrite;
  }

  _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (!this.wrote) {
      this.wrote = true;
      this.onFirstWrite?.();
    }
    callback();
  }
}
