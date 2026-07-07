#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { promptTerminalSelect } from "../../lib/terminal-select";

test("terminal selector restores paused stdin after selection", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  const originalStdin = process.stdin;
  const originalStderr = process.stderr;
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  Object.defineProperty(process, "stderr", { value: output, configurable: true });
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
    );
    input.write("\u001b[B");
    input.write("\r\n");
    assert.equal(await selected, "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    Object.defineProperty(process, "stderr", { value: originalStderr, configurable: true });
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

  _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    callback();
  }
}
