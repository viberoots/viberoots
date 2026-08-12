export function assertRustIdentityGraph(graphText: string, target: string): void {
  const graph = JSON.parse(graphText) as
    | Array<Record<string, unknown>>
    | { nodes?: Array<Record<string, unknown>> };
  const nodes = Array.isArray(graph) ? graph : graph.nodes || [];
  const appNode = nodes.find((node) => node.name === target);
  if (
    appNode?.cargo_package !== "rust-parity" ||
    appNode.public_crate !== "rust_parity" ||
    appNode.crate_type !== "bin" ||
    appNode.host_role !== "target"
  ) {
    throw new Error("canonical update exported stale Rust composition attributes");
  }
}
