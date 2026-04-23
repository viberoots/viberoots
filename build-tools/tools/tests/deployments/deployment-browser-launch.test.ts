#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { launchBrowser } from "../../deployments/deployment-browser-launch.ts";

class FakeChild extends EventEmitter {
  unref() {}
}

test("browser launch resolves when the launcher exits successfully", async () => {
  await assert.doesNotReject(() =>
    launchBrowser("https://example.com", {
      spawnImpl: () => {
        const child = new FakeChild();
        queueMicrotask(() => child.emit("exit", 0, null));
        return child as any;
      },
      settleMs: 5,
    }),
  );
});

test("browser launch reports launcher exit failures", async () => {
  await assert.rejects(
    () =>
      launchBrowser("https://example.com", {
        spawnImpl: () => {
          const child = new FakeChild();
          queueMicrotask(() => child.emit("exit", 1, null));
          return child as any;
        },
        settleMs: 5,
      }),
    /exited with code 1/,
  );
});

test("browser launch reports spawn failures", async () => {
  await assert.rejects(
    () =>
      launchBrowser("https://example.com", {
        spawnImpl: () => {
          const child = new FakeChild();
          queueMicrotask(() => child.emit("error", new Error("permission denied")));
          return child as any;
        },
        settleMs: 5,
      }),
    /permission denied/,
  );
});

test("browser launch resolves once the launcher survives the startup window", async () => {
  await assert.doesNotReject(() =>
    launchBrowser("https://example.com", {
      spawnImpl: () => new FakeChild() as any,
      settleMs: 5,
    }),
  );
});
