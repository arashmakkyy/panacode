# MCP servers

A card that manages the MCP (Model Context Protocol) servers that give an agent its tools: what the enabled tool
definitions cost in context, which servers are connected, and which single tools are on.

This is an independent implementation of the block documented at
<https://uiarc.dev/components/blocks/mcp-servers>. It follows that page's API, markup, measurements, motion and copy,
and it is built on Arc's free registry components (Animated counter, Avatar, Button, Input, Search field, Segmented
control, Switch, Text shimmer). Arc's own source for this block is part of Arc Pro and is not included here.

## Files

| File | What it holds |
| --- | --- |
| `mcp-servers.tsx` | The block: card, context meter, server rows, undo bar. |
| `connect-sheet.tsx` | The sheet: directory, connect by URL, authorize, tool discovery. |
| `parts.tsx` | Marks, cross fade slot, rolling numbers, status and access labels, tool row. |
| `mcp-servers.module.css` | All styles. Container queries at 520px and 400px. |
| `types.ts` | Public types. |
| `format.ts` | Token formatting, URL parsing, tool defaults. |
| `sample-data.ts` | Sample servers, directory and account for the demo. |
| `brand-glyphs.ts` | Brand marks (Simple Icons, CC0) and the MCP mark. |

## Setup

1. Install the dependencies the Arc components use:

   ```bash
   npm install motion lucide-react @radix-ui/react-switch
   ```

2. Import Arc's theme tokens once, before your own styles. Skip this if your app already carries them.

   ```ts
   import "@/components/arc/arc-theme.css";
   ```

3. Load the two faces the tokens name: `Inter Variable` for body text and `Geist Variable` for headings. With
   `next/font`, set `--font-inter` and `--font-geist` instead.

4. Dark mode is `data-theme="dark"` on the root element.

## Usage

```tsx
import { McpServers } from "@/components/arc/blocks/mcp-servers/mcp-servers";

export function AgentTools({ servers, directory }) {
  return (
    <McpServers
      servers={servers}
      directory={directory}
      budget={8000}
      clientName="Northwind agent"
      account={{ name: "Emma Collins", email: "emma@northwind.dev", avatar: "/media/people/emma-collins.svg" }}
      onToggleTool={(serverId, toolId, enabled) => saveTool(serverId, toolId, enabled)}
      onPermissionChange={(serverId, permission) => savePermission(serverId, permission)}
      onConnect={async ({ kind, serverId, endpoint }) => {
        if (kind !== "url" && kind !== "retry") await openOAuthWindow(serverId);
        const response = await fetch(`/api/mcp/${serverId}/tools`, { method: "POST", body: JSON.stringify({ endpoint }) });
        if (!response.ok) throw new Error("The server closed the connection during tools/list.");
        return response.json(); // [{ id, name, access, tokens }]
      }}
      onRemove={serverId => fetch(`/api/mcp/${serverId}`, { method: "DELETE" })}
    />
  );
}
```

With no props it shows the sample servers and simulates every connection.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `servers` | `McpServer[]` | sample servers | The agent's servers. Only enabled tools of connected servers count toward context. Passing a new array replaces the list. |
| `directory` | `McpDirectoryEntry[]` | sample directory | What Add server offers. Entries whose id is already in the list read Added. |
| `budget` | `number` | `8000` | Tokens of context to spend on tool definitions. Past it the bar rescales and the overflow turns amber. |
| `title` | `string` | `"MCP servers"` | Heading of the card. |
| `clientName` | `string` | `"Northwind agent"` | Your agent's name on the authorize screen. |
| `clientMark` | `ReactNode` | Northwind mark | Your agent's mark on the authorize screen. |
| `account` | `{ name; email; avatar? }` | Emma Collins | The signed in person shown on the authorize screen. |
| `onToggleTool` | `(serverId, toolId, enabled) => void` | – | A tool was switched on or off. |
| `onConnect` | `(request) => void \| McpReportedTool[] \| Promise<…>` | – | A server connects: `{ kind: "directory" \| "url" \| "reconnect" \| "retry", serverId, name, transport, endpoint? }`. Resolve with the tools the server reported, or with nothing to keep the tools already known. A rejection shows the error's message with Try again. |
| `onRemove` | `(serverId) => void` | – | A removal became final: its undo window closed (about 6 seconds, held while the pointer or focus rests on the bar) or another remove started. |
| `onPermissionChange` | `(serverId, permission) => void` | – | A server's default for tool calls changed. |
| `className` | `string` | – | Class on the root element. |

## Where it departs from the public preview

The block was checked against Arc's live preview element by element, in light and dark, at 720px, 450px and 302px.
It differs on purpose in these places:

- **Wired mode is truthful.** Once `onConnect` is set, the authorize screen drops the "Simulated sign in" tag and the
  "No account is contacted" note, and `onConnect` runs inside the Authorize press itself, so a consent window opened
  there is not blocked. A server added by URL then lists only the tools your client reports.
- **The card grows for the sheet.** While the sheet is open the card is at least 600px tall, as the documentation
  describes. In the preview this has no effect, because the length is passed without a unit.
- **Focus never drops to the page.** Try again moves focus to the step heading, the dialog itself can hold focus, and
  after Add server focus always lands on the new row.
- **Small guards.** Cancel during the simulated authorize delay really cancels, a tool reported twice is listed once,
  and adding back a server that is waiting in the undo bar clears that pending removal.
- **The sample avatar** is a gradient drawn for this project, not Arc's image.
