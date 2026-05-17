#!/usr/bin/env zx-wrapper
import { spawnSync } from "node:child_process";
import type { SprinkleRefStore } from "./sprinkleref-types";

export type KeychainRunner = (
  command: string,
  args: string[],
) => { status: number; stdout?: string; stderr?: string };

export function macosKeychainCommand(
  action: "read" | "add" | "update" | "remove",
  service: string,
  account: string,
  value?: string,
) {
  if (action === "read") return ["find-generic-password", "-s", service, "-a", account, "-w"];
  if (action === "remove") return ["delete-generic-password", "-s", service, "-a", account];
  const args = ["add-generic-password", "-s", service, "-a", account, "-w", value || ""];
  if (action === "update") args.push("-U");
  return args;
}

export class SprinkleRefMacosKeychainStore implements SprinkleRefStore {
  private readonly service: string;
  private readonly platform: NodeJS.Platform;
  private readonly runner: KeychainRunner;

  constructor(
    service: string,
    platform: NodeJS.Platform = process.platform,
    runner: KeychainRunner = defaultRunner,
  ) {
    this.service = service;
    this.platform = platform;
    this.runner = runner;
  }

  describe() {
    return `macos-keychain service ${this.service}`;
  }

  async has(ref: string) {
    this.assertSupported();
    return this.runner("security", macosKeychainCommand("read", this.service, ref)).status === 0;
  }

  async read(ref: string) {
    this.assertSupported();
    const result = this.runner("security", macosKeychainCommand("read", this.service, ref));
    return result.status === 0 ? String(result.stdout || "").trimEnd() : undefined;
  }

  async add(ref: string, value: string) {
    this.assertSupported();
    if (await this.has(ref)) throw new Error(`${ref} already exists`);
    this.run("add", ref, value);
  }

  async update(ref: string, value: string) {
    this.assertSupported();
    if (!(await this.has(ref))) throw new Error(`${ref} is missing`);
    this.run("update", ref, value);
  }

  async remove(ref: string) {
    this.assertSupported();
    if (!(await this.has(ref))) throw new Error(`${ref} is missing`);
    this.run("remove", ref);
  }

  private run(action: "add" | "update" | "remove", ref: string, value?: string) {
    const result = this.runner("security", macosKeychainCommand(action, this.service, ref, value));
    if (result.status !== 0) throw new Error(`macOS Keychain ${action} failed for ${ref}`);
  }

  private assertSupported() {
    if (this.platform !== "darwin") {
      throw new Error("macos-keychain SprinkleRef backend requires macOS; use local-file");
    }
  }
}

function defaultRunner(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}
