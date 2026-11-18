import { ClaudeMark, GeminiMark, GitHubMark, MistralMark, OpenAIMark, PostgresMark } from "./marks";
import type {
  AiChatHistoryItem,
  ChatModel,
  ChatRespond,
  ChatSource,
  ChatSuggestion,
  ChatTool,
} from "./types";

export const sampleModels: ChatModel[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "Anthropic", mark: ClaudeMark, color: "#D97757" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Anthropic", mark: ClaudeMark, color: "#D97757" },
  { id: "gpt-6-1-sol", name: "GPT-6.1 Sol", note: "OpenAI", mark: OpenAIMark },
  { id: "gemini-4-argon", name: "Gemini 4 Argon", note: "Google", mark: GeminiMark },
  { id: "mistral-large-4", name: "Mistral Large 4", note: "Mistral AI", mark: MistralMark },
];

const postgres = { mark: PostgresMark, color: "#4169E1" };

const alterTable: ChatSource = {
  ...postgres,
  title: "PostgreSQL 17: ALTER TABLE",
  url: "https://www.postgresql.org/docs/17/sql-altertable.html",
  snippet:
    "Validating a constraint takes only a SHARE UPDATE EXCLUSIVE lock, and SET NOT NULL skips the table scan when a valid CHECK constraint already proves no NULL can exist.",
};

const explicitLocking: ChatSource = {
  ...postgres,
  title: "PostgreSQL 17: Explicit locking",
  url: "https://www.postgresql.org/docs/17/explicit-locking.html",
  snippet:
    "SHARE UPDATE EXCLUSIVE protects a table against concurrent schema changes and VACUUM runs. It does not conflict with the ROW EXCLUSIVE lock that writes take.",
};

const strongMigrations: ChatSource = {
  mark: GitHubMark,
  title: "strong_migrations: Setting NOT NULL on an existing column",
  url: "https://github.com/ankane/strong_migrations",
  snippet:
    "Add a check constraint without validating existing rows, validate it in a separate step, then set NOT NULL.",
};

const clientDefaults: ChatSource = {
  ...postgres,
  title: "PostgreSQL 17: Client connection defaults",
  url: "https://www.postgresql.org/docs/17/runtime-config-client.html",
  snippet:
    "lock_timeout aborts any statement that waits longer than the given time while trying to acquire a lock.",
};

const createIndex: ChatSource = {
  ...postgres,
  title: "PostgreSQL 17: CREATE INDEX",
  url: "https://www.postgresql.org/docs/17/sql-createindex.html",
  snippet:
    "With CONCURRENTLY, PostgreSQL builds the index without taking any locks that prevent concurrent inserts, updates or deletes on the table.",
};

interface Script {
  id: string;
  match: RegExp;
  title: string;
  reasoning: string;
  seconds: number;
  tool?: ChatTool;
  sources?: ChatSource[];
  /** Fails the first attempt with this message, then succeeds on retry. */
  failFirst?: string;
  text: string;
  /** Replaces the first line on later attempts so a retry reads differently. */
  retryLead?: string;
}

const estimate: Script = {
  id: "estimate",
  match: /how long|estimate|backfill take|per batch|duration/i,
  title: "Backfill estimate",
  reasoning:
    "Use the real row count rather than the planner estimate, then multiply the batch count by a realistic time per batch, including a pause for the replicas.",
  seconds: 2,
  tool: {
    id: "count",
    name: "Queried orders",
    activeName: "Querying orders",
    status: "done",
    summary: "40,213,880 rows",
    icon: "database",
    ...postgres,
    input: ["SELECT count(*) FROM orders;"],
    output: "40,213,880",
  },
  text: [
    "About 23 minutes. The table has 40,213,880 rows, so 5,000 rows per batch makes 8,043 batches.",
    "",
    "- **Per batch:** about 120 ms for the update and a 50 ms pause so replicas keep up",
    "- **Total:** 8,043 \u00d7 170 ms \u2248 1,367 s, or just under 23 minutes",
    "- **Lag:** if replication lag passes 5 s, double the pause instead of shrinking the batch",
    "",
    "Walk the primary key in ranges, so every batch uses the index and never rescans finished rows:",
    "",
    "```sql",
    "UPDATE orders o",
    "SET region = c.region",
    "FROM customers c",
    "WHERE c.id = o.customer_id",
    "  AND o.id >= $1 AND o.id < $1 + 5000",
    "  AND o.region IS NULL;",
    "```",
  ].join("\n"),
  retryLead: "Just under 23 minutes, at about 170 ms for each of the 8,043 batches.",
};

const lag: Script = {
  id: "lag",
  match: /\blag\b|replica/i,
  title: "Replication lag",
  reasoning:
    "Read the replay delay on the replica itself, then compare it with the threshold the backfill should pause at.",
  seconds: 2,
  tool: {
    id: "lag",
    name: "Queried replica-eu-2",
    activeName: "Querying replica-eu-2",
    status: "done",
    summary: "0.4 s behind",
    icon: "database",
    ...postgres,
    input: ["SELECT now() - pg_last_xact_replay_timestamp() AS lag;"],
    output: "00:00:00.412",
  },
  failFirst: "Could not reach replica-eu-2. The connection timed out after 10 seconds.",
  text: [
    "replica-eu-2 is **0.4 seconds** behind the primary, well inside a safe range for a batched backfill.",
    "",
    "- **Replay lag:** 0.4 s",
    "- **Received but not replayed:** 2.1 MB of WAL",
    "- **Rule of thumb:** pause the backfill when lag passes 5 s, and resume once it drops under 1 s",
  ].join("\n"),
};

const fallback: Script = {
  id: "verify",
  match: /$^/,
  title: "",
  reasoning:
    "This preview only knows the orders migration, so answer with the step that usually comes next: checking the backfill before release.",
  seconds: 1,
  text: "In this preview I only know the `orders` migration, so here is the step that usually comes next: check the backfill before you ship.\n\n```sql\nSELECT count(*) FROM orders WHERE region IS NULL;\n\nSELECT conname, convalidated FROM pg_constraint\nWHERE conrelid = 'orders'::regclass;\n```\n\nYou want zero rows without a region, and `convalidated` set to true for the check.",
};

const scripts: Script[] = [
  lag,
  {
    id: "rollback",
    match: /roll ?back|undo|revert/i,
    title: "Rollback plan",
    reasoning:
      "Each step is reversible on its own, and the column can stay until the app stops reading it.",
    seconds: 2,
    text: "Each step can be undone on its own, and none of them loses data.\n\n1. **Before `SET NOT NULL`:** drop the check constraint. Writes never noticed it.\n2. **After `SET NOT NULL`:** run `ALTER COLUMN region DROP NOT NULL`, which is instant.\n3. **The column itself:** leave it in place until the app stops reading it, then drop it in a later release.\n\nKeep `region IS NULL` in the backfill's `WHERE` clause, so a rerun after a rollback only touches the rows it missed.",
    retryLead: "Every step is reversible, and you can undo them in reverse order without losing data.",
  },
  {
    id: "index",
    match: /index/i,
    title: "Index on region",
    reasoning:
      "A plain CREATE INDEX blocks writes for the whole build. CONCURRENTLY avoids that at the cost of a slower build.",
    seconds: 3,
    tool: {
      id: "search-index",
      name: "Searched the web",
      activeName: "Searching the web",
      status: "done",
      summary: "1 source",
      icon: "search",
      input: ["postgres 17 create index concurrently"],
    },
    sources: [createIndex],
    text: "Build it with `CREATE INDEX CONCURRENTLY`, so writes keep flowing while it builds. [1]\n\n```sql\nCREATE INDEX CONCURRENTLY orders_region_idx ON orders (region);\n```\n\nIt takes longer than a normal build and cannot run inside a transaction block. If it fails, it leaves an invalid index behind: drop it and run the build again.",
  },
  estimate,
  {
    id: "add-column",
    match: /not null|non-null|nonnull|add (a |the )?(\w+ )?column|without (blocking|downtime|locking)/i,
    title: "Add region to orders",
    reasoning:
      "A NOT NULL column with no default fails on existing rows, and setting it on a filled column scans 40M rows under an exclusive lock. Safer path: nullable column, batched backfill, a NOT VALID check, validation under a weaker lock, then SET NOT NULL, which can skip the scan. Confirm the lock levels in the docs.",
    seconds: 4,
    tool: {
      id: "search",
      name: "Searched the web",
      activeName: "Searching the web",
      status: "done",
      summary: "4 sources",
      icon: "search",
      input: ["postgres 17 set not null without table scan", "validate constraint lock level"],
    },
    sources: [alterTable, explicitLocking, strongMigrations, clientDefaults],
    text: "Split it into four short steps, so no single statement holds a heavy lock for long.\n\n1. **Add the column as nullable.** With no default, this only touches the catalog and returns at once.\n2. **Backfill in batches** of about 5,000 rows, committing each batch so transactions stay short and autovacuum keeps up.\n3. **Add a `NOT VALID` check, then validate it.** Validation scans the table under a `SHARE UPDATE EXCLUSIVE` lock, so reads and writes keep flowing. [1][2]\n4. **Set `NOT NULL`.** Postgres sees the validated check and skips the full scan, so this lock lasts milliseconds. [1][3]\n\n```sql\nALTER TABLE orders ADD COLUMN region text;\n\nALTER TABLE orders ADD CONSTRAINT orders_region_not_null\n  CHECK (region IS NOT NULL) NOT VALID;\n\nALTER TABLE orders VALIDATE CONSTRAINT orders_region_not_null;\nALTER TABLE orders ALTER COLUMN region SET NOT NULL;\nALTER TABLE orders DROP CONSTRAINT orders_region_not_null;\n```\n\nRun each `ALTER` with a short `lock_timeout`, such as `2s`, so a statement stuck behind a long query gives up instead of queueing every write behind it. [4]",
    retryLead: "Do it in four steps, each holding a heavy lock for only a moment.",
  },
];

const scriptFor = (prompt: string) => scripts.find((script) => script.match.test(prompt)) ?? fallback;

/** A short title for a conversation, taken from its first message. */
export function titleFor(prompt: string): string {
  const known = scriptFor(prompt).title;
  if (known) return known;
  const words = prompt
    .replace(/[`*?.!]+/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  return words.length > 40 ? `${words.slice(0, 38)}\u2026` : words || "New chat";
}

export const DEMO_PROMPT =
  "We need a non-null `region` column on our 40M row `orders` table in Postgres 17. How do we add it without blocking writes?";

export const DEMO_FOLLOW_UP = "How long will the backfill take at 5,000 rows per batch?";

export const sampleSuggestions: ChatSuggestion[] = [
  {
    label: "Add a NOT NULL column without downtime",
    prompt: "How do I add a NOT NULL column to a 40M row table without blocking writes?",
    icon: "database",
  },
  {
    label: "Estimate a backfill for 40M rows",
    prompt: "How long will a backfill of 40M rows take at 5,000 rows per batch?",
    icon: "timer",
  },
  { label: "Check replication lag on replica-eu-2", icon: "activity" },
];

export const sampleHistory: AiChatHistoryItem[] = [
  {
    id: "partition-events",
    title: "Partition the events table",
    group: "Today",
    messages: [
      {
        role: "user",
        content: "Should we partition `events` by month or by week? It grows by about 90M rows a month.",
      },
      {
        role: "assistant",
        model: "claude-opus-5-5",
        thoughtFor: 3,
        reasoning:
          "At 90M rows a month the main costs are vacuum time and retention deletes. Monthly partitions keep both cheap without a large partition count.",
        content:
          "By month. At about 90M rows a month, each partition stays small enough for quick vacuums and index builds, and the partition count stays low.\n\n- **Retention:** dropping a month is one `DETACH PARTITION` and a `DROP TABLE`, with no bulk delete\n- **Queries:** filters on `created_at` prune to one or two partitions\n- **Weekly** partitions only pay off once a single month gets slow to vacuum",
      },
    ],
  },
  {
    id: "status-page",
    title: "Status page incident draft",
    group: "Previous 7 days",
    messages: [
      {
        role: "user",
        content:
          "Draft a status page update for the checkout slowdown on October 14. It was resolved at 15:40 UTC.",
      },
      {
        role: "assistant",
        model: "claude-sonnet-5-5",
        thoughtFor: 2,
        reasoning:
          "Lead with the impact and the time window, say plainly that no payment was lost, then the cause and the fix.",
        content:
          "**Resolved: slower checkout**\n\nBetween 14:55 and 15:40 UTC on October 14, some customers saw checkout take longer than usual. No payment was lost or charged twice. A database migration held a lock for longer than expected; we stopped it, and checkout recovered at 15:40 UTC.\n\nWe are adding lock timeouts to every migration, so a schema change cannot hold up checkout again.",
      },
    ],
  },
  {
    id: "churn-themes",
    title: "Churn interview themes",
    group: "Previous 7 days",
    messages: [
      { role: "user", content: "Summarize the themes from the 12 churn interviews in three bullets." },
      {
        role: "assistant",
        model: "gpt-6-1-sol",
        thoughtFor: 5,
        reasoning:
          "Group the notes by the reason each customer gave first, then count how many interviews mention each.",
        content:
          "- **Setup took too long:** 7 of 12 never finished connecting their data in the first week\n- **Pricing jumped at 10 seats:** 4 left at renewal when the team plan started\n- **Exports were missing:** 3 needed CSV exports for finance and moved to a tool that had them",
      },
    ],
  },
];

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/** Cuts text into pieces of about `size` characters that end on a space. */
function pieces(text: string, size: number): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + size);
    const space = text.indexOf(" ", end);
    end = space === -1 || space - end > 12 ? end : space + 1;
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

/** Scripted replies for the preview: reasoning, an optional tool, sources, then text. */
export function createSampleResponder(): ChatRespond {
  const attempts = new Map<string, number>();

  return async function* (messages, { signal }) {
    const prompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const script = scriptFor(prompt);
    const attempt = attempts.get(script.id) ?? 0;
    attempts.set(script.id, attempt + 1);

    for (const delta of pieces(script.reasoning, 34)) {
      await wait(110, signal);
      if (signal.aborted) return;
      yield { type: "reasoning", delta };
    }
    yield { type: "reasoning-end", seconds: script.seconds };

    if (script.tool) {
      const failing = !!script.failFirst && attempt === 0;
      yield { type: "tool", tool: { ...script.tool, status: "running", summary: undefined, output: undefined } };
      await wait(failing ? 1400 : 850, signal);
      if (signal.aborted) return;
      if (failing) {
        yield {
          type: "tool",
          tool: {
            ...script.tool,
            status: "error",
            name: script.tool.activeName ?? script.tool.name,
            summary: "Timed out",
            output: undefined,
          },
        };
        yield { type: "error", message: script.failFirst! };
        return;
      }
      yield { type: "tool", tool: { ...script.tool, sources: script.sources } };
    }

    if (script.sources) yield { type: "sources", sources: script.sources };

    const text =
      attempt > 0 && script.retryLead ? script.text.replace(/^[^\n]+/, script.retryLead) : script.text;

    await wait(120, signal);
    for (const delta of pieces(text, 42)) {
      if (signal.aborted) return;
      yield { type: "text", delta };
      await wait(18, signal);
    }
  };
}
