#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runRustWatch, type RustWatchDeps } from "../../dev/rust-dev-watch";
import { runInTemp } from "../lib/test-helpers";

class FakeChild extends EventEmitter {
  static nextPid = 2000;
  pid = FakeChild.nextPid++;
  signals: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals) {
    this.signals.push(signal);
    return true;
  }
}

function depsFor(opts: {
  spawn: () => FakeChild;
  wait: () => Promise<void>;
  ownerAlive?: () => boolean;
  events?: string[];
  closeOnKill?: boolean;
}): RustWatchDeps {
  return {
    spawnChild: opts.spawn,
    wait: opts.wait,
    ownerAlive: opts.ownerAlive || (() => true),
    onEvent: (event) => opts.events?.push(event),
    signalGroup: (child, signal) => {
      const fake = child as FakeChild;
      fake.signals.push(signal);
      if (signal === "SIGKILL" && opts.closeOnKill !== false) {
        queueMicrotask(() => fake.emit("close", 137));
      }
    },
  };
}

test("Rust watcher awaits the owned process group before replacement", async () => {
  await runInTemp("rust-watch-owned-restart", async (tmp) => {
    const source = path.join(tmp, "src");
    await fs.mkdir(source);
    const rust = path.join(source, "lib.rs");
    await fs.writeFile(rust, "pub fn value() -> i32 { 1 }\n");
    const children: FakeChild[] = [];
    let stop = false;
    let waits = 0;
    const running = runRustWatch({
      roots: [source],
      pollMs: 1,
      stopGraceMs: 50,
      shouldStop: () => stop,
      deps: depsFor({
        spawn: () => {
          const child = new FakeChild();
          children.push(child);
          return child;
        },
        wait: async () => {
          waits += 1;
          if (waits === 1) await fs.writeFile(rust, "pub fn value() -> i32 { 2 }\n");
          else stop = true;
        },
      }),
    });
    while (children[0]?.signals[0] !== "SIGTERM") await new Promise((r) => setImmediate(r));
    assert.equal(children.length, 1, "replacement must wait for the prior close event");
    children[0].emit("close", 0);
    await running;
    assert.equal(children.length, 2);
    assert.deepEqual(children[0].signals, ["SIGTERM"]);
    assert.deepEqual(children[1].signals, ["SIGTERM", "SIGKILL"]);
  });
});

test("Rust watcher serializes package and explicit override edits and survives a failed child", async () => {
  await runInTemp("rust-watch-rapid-edits", async (tmp) => {
    const source = path.join(tmp, "crate");
    const override = path.join(tmp, "override-crate");
    await fs.mkdir(source);
    await fs.mkdir(override);
    const rust = path.join(source, "lib.rs");
    const overrideRust = path.join(override, "lib.rs");
    await fs.writeFile(rust, "0\n");
    await fs.writeFile(overrideRust, "0\n");
    const children: FakeChild[] = [];
    const events: string[] = [];
    let cycle = 0;
    let stop = false;
    await runRustWatch({
      roots: [source, override],
      pollMs: 1,
      stopGraceMs: 5,
      shouldStop: () => stop,
      deps: depsFor({
        events,
        spawn: () => {
          const child = new FakeChild();
          children.push(child);
          if (children.length === 2) queueMicrotask(() => child.emit("close", 2));
          return child;
        },
        wait: async () => {
          cycle += 1;
          if (cycle === 2) await fs.writeFile(overrideRust, `${cycle}\n`);
          else if (cycle <= 3) await fs.writeFile(rust, `${cycle}\n`);
          else stop = true;
        },
      }),
    });
    assert.equal(children.length, 4, "initial process plus one replacement per observed edit");
    assert.equal(events.filter((event) => event === "spawn").length, 4);
    assert.ok(
      events.includes("close"),
      "failed build exit must be observed without stopping watch",
    );
    assert.ok(children.every((child) => child.listenerCount("close") === 0));
  });
});

test("Rust watcher handles owner death and bounded TERM-to-KILL cleanup", async () => {
  await runInTemp("rust-watch-owner-death", async (tmp) => {
    await fs.writeFile(path.join(tmp, "Cargo.toml"), "[package]\nname='demo'\nversion='0.1.0'\n");
    const child = new FakeChild();
    let alive = true;
    await runRustWatch({
      roots: [tmp],
      pollMs: 1,
      stopGraceMs: 5,
      shouldStop: () => false,
      deps: depsFor({
        spawn: () => child,
        ownerAlive: () => alive,
        closeOnKill: false,
        wait: async () => {
          alive = false;
        },
      }),
    });
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(child.listenerCount("close"), 0);
  });
});
