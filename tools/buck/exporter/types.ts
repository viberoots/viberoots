#!/usr/bin/env zx-wrapper
export interface Node {
  name: string;
  rule_type: string;
  labels?: string[];
  srcs?: string[];
}

export interface Tuple {
  goos: string;
  goarch: string;
  cgo: string;
  tagsKey: string;
  goflagsKey: string;
  toolchain: string;
}

export interface GoPkg {
  ImportPath?: string;
  Dir?: string;
  Deps?: string[];
  Imports?: string[];
  ForTest?: string | null;
  Module?: {
    Path?: string;
    Version?: string;
    Replace?: { Path?: string; Version?: string } | null;
  } | null;
}

export interface Batch {
  tuple: Tuple;
  members: Node[];
  roots: string[];
  cwd: string;
}

export interface Metrics {
  totalBatches: number;
  cacheHits: number;
  cacheMisses: number;
  durationMs: number;
  tupleKeys: string[];
}

export interface Adapter {
  name: string;
  isNode(n: Node): boolean;
  buildBatches(nodes: Node[]): Promise<Batch[]>;
  attachLabels(nodes: Node[], batches: Batch[], cacheDir: string): Promise<Node[]>;
}
