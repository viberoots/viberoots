#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import {
  ALLOW_COMMENT,
  findExplicitIsolationViolations,
} from "./run-in-temp-buck-isolation-lint.ts";

test("runInTemp isolation lint approves inherited forms per command only", () => {
  const fixture = String.raw`
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  await $\`buck2 --isolation-dir \${isoForTmp(tmp)} build //:bad\`;
  await $\`buck2 --isolation-dir \${inheritedBuckIsolation("good")} build //:good\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 1) {
    throw new Error(`expected 1 violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint rejects same-line inherited neighbor approval", () => {
  const fixture = String.raw`
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  await $\`buck2 --isolation-dir \${isoForTmp(tmp)} build //:bad\`; await $\`buck2 --isolation-dir \${inheritedBuckIsolation("good")} build //:good\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 1) {
    throw new Error(`expected 1 violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint approves BUCK_NESTED_ISO per command only", () => {
  const fixture = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  await $\`buck2 --isolation-dir \${isoForTmp(tmp)} build //:bad\`;
  await $\`buck2 --isolation-dir \${process.env.BUCK_NESTED_ISO} build //:good\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 1) {
    throw new Error(`expected 1 violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint approves multiline inherited commands", () => {
  const fixture = String.raw`
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
await runInTemp("good", async (tmp, $) => {
  await $\`buck2
    --isolation-dir \${inheritedBuckIsolation("good")}
    build //:good\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 0) {
    throw new Error(`expected no violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint approves allow comments per command only", () => {
  const fixture = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  // ${ALLOW_COMMENT}: validates isolated cache invalidation with a separate daemon
  await $\`buck2 --isolation-dir separate build //:allowed\`;
  await $\`buck2 --isolation-dir \${isoForTmp(tmp)} build //:bad\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 1) {
    throw new Error(`expected 1 violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint approves multiline allow-comment commands", () => {
  const fixture = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("good", async (tmp, $) => {
  // ${ALLOW_COMMENT}: validates isolated cache invalidation with a separate daemon
  await $\`buck2
    --isolation-dir separate
    build //:allowed\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 0) {
    throw new Error(`expected no violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint rejects same-line allow-comment neighbor approval", () => {
  const fixture = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  await $\`buck2 --isolation-dir \${isoForTmp(tmp)} build //:bad\`; await $\`buck2 --isolation-dir separate build //:allowed ${ALLOW_COMMENT}: validates isolated cache invalidation with a separate daemon\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 1) {
    throw new Error(`expected 1 violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint limits previous-line allow comments to the next command", () => {
  const fixture = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  // ${ALLOW_COMMENT}: validates isolated cache invalidation with a separate daemon
  await $\`buck2 --isolation-dir separate build //:allowed\`; await $\`buck2 --isolation-dir \${isoForTmp(tmp)} build //:bad\`;
});
`;
  const hits = findExplicitIsolationViolations(fixture);
  if (hits.length !== 1) {
    throw new Error(`expected 1 violation, got ${JSON.stringify(hits)}`);
  }
});
