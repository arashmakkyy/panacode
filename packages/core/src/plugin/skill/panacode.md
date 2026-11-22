# Panacode

Use this guide as the starting point for work involving Panacode itself. It
covers the core concepts needed to configure and customize Panacode, extend it
with plugins, and build integrations with the Panacode SDK, clients, and API.

Use the installed `panacode --help`, the matching checkout's `PANACODE.md`,
`panacode-docs/`, and package sources for Panacode-specific paths and behavior.
The links below describe shared upstream APIs. Check them against the Panacode
version in use when they mention product settings, startup, or storage.

## [CLI](https://opencode.ai/docs/cli)

For questions about the terminal interface, command-line invocation, `run`,
`mini`, terminal providers, or other CLI behavior, fetch the
[CLI guide](https://opencode.ai/docs/cli) and the relevant page linked from
that section.

CLI and TUI preferences are separate from Panacode's server and project
configuration. They live in the global `~/.config/panacode/cli.json`, or
`$XDG_CONFIG_HOME/panacode/cli.json` when `XDG_CONFIG_HOME` is set. There is no
project-local CLI configuration. Set `PANACODE_CLI_CONFIG_CONTENT` to merge
inline JSON over the global settings. Most preferences can also be changed from
the TUI by pressing `Ctrl+P` and selecting **Open settings**.

### [Settings](https://opencode.ai/docs/cli/config)

Fetch the full [CLI settings reference](https://opencode.ai/docs/cli/config)
before editing `cli.json`. It documents every terminal-only setting, accepted
values, and examples, including themes, input, sessions, tabs, diffs, alerts,
Mini, keybindings, terminal plugins, and debugging. Do not put these settings
in `panacode.json(c)`.

### [Keybinds](https://opencode.ai/docs/cli/keybinds)

Configure keybindings under `keybinds` in `cli.json`. The leader key is the
`keybinds.leader` entry; leader timing is configured separately under
`leader.timeout`. Bindings can use a string, an array of strings, or an object
when event behavior such as `preventDefault` is required. Disable a binding
with `"none"` or `false`.

Never guess a command ID, default binding, or accepted key syntax. Fetch the
full [keybind reference](https://opencode.ai/docs/cli/keybinds), which lists
the current IDs and defaults, before answering or editing a binding.

## [Panacode configuration](https://opencode.ai/docs/config)

Panacode's server and project configuration uses JSON or JSONC. Include the
published schema so the user's editor can validate fields and provide
autocomplete:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
}
```

Global configuration lives at `~/.config/panacode/panacode.json(c)` and applies
to every project for that user. Project configuration can live in any directory
as `panacode.json(c)` or `.panacode/panacode.json(c)`, including nested packages
in a monorepo.

During ordinary project discovery, Panacode searches the current Location
directory and every ancestor through the filesystem root, including directories
above the detected project or repository root. It merges direct
`panacode.json(c)` files from the farthest ancestor to the current directory,
then does the same for `.panacode/panacode.json(c)` files. This means every
discovered `.panacode` config overrides every discovered direct config. Global
filesystem configuration has lower precedence than these discovered documents.

Common configuration fields include `model`, `default_agent`, `permissions`,
`agents`, `commands`, `plugins`, `providers`, `mcp`, `skills`, `instructions`,
`references`, `formatter`, and `lsp`.

This configuration is distinct from `cli.json`. Use the
[CLI settings reference](https://opencode.ai/docs/cli/config) for terminal
preferences, especially themes and keybindings.

Config changes apply without a restart. Panacode watches config files and
reloads agents, commands, skills, MCP servers, and plugins after a save. The TUI
does the same for `cli.json`. To force a full reload, use `/reload`. Don't tell
the user to restart Panacode after editing config.

Do not guess field names or shapes. Check the configuration schema for the installed Panacode version, and preserve unrelated settings when
editing an existing file. Keep the published `$schema` URL in configuration
examples, but do not fetch it to determine the V2 configuration shape.

See the [full configuration guide](https://opencode.ai/docs/config) for
every field, examples, config locations, and links to dedicated feature guides.

## [MCP servers](https://opencode.ai/docs/mcp-servers)

Configure MCP servers under `mcp.servers`. Prefer the CLI because it preserves
unrelated configuration. Use `--global` when the user asks to set up a service
for themselves without limiting it to the current project; omit it when they
explicitly want project-local configuration.

```sh
panacode mcp add <name> --global --url <remote-url>
panacode mcp list
```

Remote servers use OAuth by default. If `mcp list` reports that a server needs
authentication, tell the user to run `/mcps`, select the server, and sign in.
Do not run `panacode mcp auth` through the shell tool: it starts an interactive
flow whose authorization link can be hidden in background process output.
Use the user-facing MCP interface instead.

Report the server as configured but awaiting sign-in until its connection
status confirms it is connected.

OAuth credentials are stored outside the Panacode configuration. Do not ask for or
store an API key when the server supports OAuth. Use header-based credentials
only when OAuth is unavailable or the user explicitly requires them, and use an
environment substitution such as `{env:MCP_API_KEY}` instead of writing a
secret into configuration.

## [V1 to V2 migration](https://opencode.ai/docs/migrate-v1)

For any request to migrate Panacode configuration, agents, commands, skills,
plugins, integrations, or other behavior from V1 to V2, read the full
[migration guide](https://opencode.ai/docs/migrate-v1) before acting. In
the repository, its source is `services/site/src/docs/content/migrate-v1.mdx`.

Work from a copy inside the user's Panacode configuration directory. Panacode
discovers project extensions in `.panacode/`. It leaves OpenCode's settings,
plugins and skills independent. The Panacode host can explicitly enable
read-only import of the `tool_output` limits from OpenCode project JSON with
`PANACODE_IMPORT_OPENCODE_TOOL_OUTPUT=1`. Every Panacode config source takes
precedence over those imported limits.

## [Plugins](https://opencode.ai/docs/build/plugins)

For questions about creating, configuring, loading, publishing, or migrating
plugins, fetch the full [plugins guide](https://opencode.ai/docs/build/plugins)
before answering. Refer to this guide when the user wants to build a plugin. It
covers hooks, transforms, tools, plugin context capabilities, and package
entrypoints. Plugins can also extend the TUI; for those, fetch the
[CLI plugin guide](https://opencode.ai/docs/build/plugins/cli).
For custom methods and events shared with other plugins or clients, fetch the
[RPC guide](https://opencode.ai/docs/build/plugins/rpc).

## [Service](https://opencode.ai/docs/troubleshooting#check-the-background-service)

Panacode uses a client-server architecture. Interfaces such as the TUI connect
to a background Panacode service, which owns sessions, configuration, plugins,
permissions, and tool execution.

Panacode normally discovers or starts the shared background service
automatically. Restart it only if it is stuck or unhealthy, not to apply
configuration changes:

```sh
panacode service restart
```

Check its status after restarting:

```sh
panacode service status
```

## [API](https://opencode.ai/docs/api)

Panacode exposes an HTTP API from its server. The API is described by an
OpenAPI document available from the running server at `/openapi.json`.

In Code Mode, use the built-in `opencode` tool namespace first, called inside
`execute` as `tools.opencode.*`. These tools skip the shell round-trip and
handle discovery and authentication; find its tools with Code Mode's `search`,
for example `search({ namespace: "opencode" })`. For anything they do not cover,
use the `panacode api` command. It uses the same discovery and authentication
flow as the TUI and may start the background service when no compatible healthy
service is available. It accepts either an HTTP method and path or an OpenAPI
operation ID.

Call an endpoint with an HTTP method and path:

```sh
panacode api get /api/info
```

Pass a request body with `--data` or `-d`, and additional headers with
`--header` or `-H`:

```sh
panacode api post /api/example --data '{"key":"value"}'
panacode api get /api/example --header 'X-Example:value'
```

Request bodies default to `Content-Type: application/json`. When Panacode is
connected to an explicit server instead of its managed background service, use
the same configured server and authentication context rather than constructing
an unauthenticated request separately.

See the [full API reference](https://opencode.ai/docs/api) for available
endpoints, parameters, request bodies, and response schemas. The
raw [OpenAPI specification](https://opencode.ai/docs/openapi.json) is also
available for code generation and other tooling.

## [Client](https://opencode.ai/docs/build/client)

For questions about connecting an application to Panacode over the network,
fetch the full [client guide](https://opencode.ai/docs/build/client) before
answering.

`@opencode/client` is the generated TypeScript client for the Panacode HTTP
API. Its methods and types come from the same contract as the API reference.
The default entrypoint exposes Promise-based resource clients and async
iterables for streaming endpoints. The `@opencode/client/effect` entrypoint
exposes typed Effects, Streams, and decoded Panacode schema values. Its
`Service` API can discover, start, stop, and authenticate with the local
background service from a Node application.

## [SDK](https://opencode.ai/docs/build/sdk)

For questions about embedding Panacode directly in an application, fetch the
full [SDK guide](https://opencode.ai/docs/build/sdk) before answering. The SDK
hosts Panacode in the application without opening an HTTP listener.

Use the [Effect SDK guide](https://opencode.ai/docs/build/sdk/effect) for
Effect applications. For Cloudflare Durable Objects, use the
[Cloudflare SDK guide](https://opencode.ai/docs/build/sdk/cloudflare).

## [Troubleshooting](https://opencode.ai/docs/troubleshooting)

Panacode runs a client and a background server. Start by determining whether a
problem belongs to the client, the shared server, or one project.

- Check the service with `panacode service status` and verify the API with
  `panacode api get /api/info`.
- Compare with `panacode --standalone`, which runs the TUI with a private
  server, to isolate shared-service issues.
- Inspect `~/.local/share/panacode/log/panacode.log`. Filter `role=cli` for
  client startup and `role=server` for sessions, providers, plugins,
  permissions, and tools.
- Run one reproduction with `PANACODE_LOG_LEVEL=DEBUG` when normal logs are not
  sufficient.
- Do not delete or edit the database, service registration, or service config
  while diagnosing a problem. Back up persistent data before inspecting it
  with external tools.
- Redact API keys, authorization headers, prompts, file contents, and other
  sensitive data before sharing diagnostics.

See the [full troubleshooting guide](https://opencode.ai/docs/troubleshooting)
for service lifecycle commands, API inspection, log locations, explicit server
connections, issue-reporting details, and local development paths.
