JIO Sample Resource

This is a simple example resource file discovered via `example.resource.json`.

- Path resolution: the `file` path in `.resource.json` is resolved relative to the resource spec file location.
- Served over HTTP at `/jio/resources/io.example.examples.sample-text` when the MCP HTTP server is running.
- Listed via `jio --list-resources` and located via `jio --where-resource io.example.examples.sample-text`.
