export function run(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("demo-node: usage\n  --help  Show help");
    return 0;
  }
  console.log("demo-node running");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = run(process.argv.slice(2));
  process.exit(code);
}
