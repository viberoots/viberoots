#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { recordFixtureInterval } from "./fixture-interval";

test("heavy two", async () => await recordFixtureInterval("heavy-two", 2_000, true));
