import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, Moon, RotateCcw, Sun } from "lucide-react";
import { ToolCall, ToolCallGroup } from "@/components/arc/tool-call/tool-call";
import type { ToolCallData } from "@/components/arc/tool-call/tool-call";
import { motionTokens } from "@/components/arc/lib/motion-tokens";

/* ------------------------------------------------------------------------------------------ */
/* Sample calls for one assistant turn                                                         */
/* ------------------------------------------------------------------------------------------ */

const WEB: ToolCallData = {
  id: "web",
  tool: "web",
  title: "Searched the web for Arc 2.4 release notes",
  titles: { running: "Searching the web for Arc 2.4 release notes" },
  status: "success",
  input: { query: "arc-ui 2.4 release blockers", recency: "7d", limit: 5 },
  output: {
    type: "list",
    items: [
      { title: "Arc 2.4 release checklist", tag: "github.com" },
      { title: "Release 2.4 planning notes", tag: "notion.so" },
      { title: "Changelog draft for 2.4", tag: "uiarc.dev" },
    ],
  },
  durationMs: 1280,
};

const GITHUB: ToolCallData = {
  id: "github",
  tool: "github",
  title: "Searched issues in arc-ui/web",
  titles: { running: "Searching issues in arc-ui/web" },
  status: "success",
  input: { repo: "arc-ui/web", query: "is:open label:release-blocker", per_page: 10 },
  output: {
    type: "list",
    items: [
      { lead: "#1284", title: "Checkout button stays disabled after a coupon is removed", tag: "checkout" },
      { lead: "#1279", title: "Invoice PDF renders blank for workspaces without a VAT id", tag: "billing" },
      { lead: "#1271", title: "Command menu loses focus after a slow search", tag: "a11y" },
      { lead: "#1266", title: "Dark theme flashes light on first paint in Safari", tag: "theme" },
    ],
  },
  durationMs: 1180,
};

const GMAIL: ToolCallData = {
  id: "gmail",
  tool: "gmail",
  title: "Read the latest thread from Stripe",
  titles: { running: "Reading the latest thread from Stripe" },
  status: "success",
  input: { from: "support@stripe.com", newer_than: "7d", max_results: 1 },
  output: {
    type: "json",
    value: {
      id: "18f2c9a7e4b1",
      subject: "Re: Invoice PDF missing VAT id",
      from: { name: "Stripe Support", email: "support@stripe.com" },
      received_at: "2026-03-18T09:42:11Z",
      labels: ["INBOX", "billing"],
      snippet: "The blank PDF happens when tax_id_collection is enabled but no id was collected.",
      messages: 3,
      attachments: [{ name: "invoice-0042.pdf", size_kb: 184, blank: true }],
      resolution: { suggested: "Fall back to the customer name when tax id is null", eta_days: 2 },
      unread: false,
    },
  },
  durationMs: 910,
};

const POSTGRES: ToolCallData = {
  id: "postgres",
  tool: "postgres",
  title: "Queried orders by region for the last 7 days",
  titles: { running: "Querying orders by region for the last 7 days" },
  status: "success",
  input: { database: "analytics", sql: "select region, count(*) as orders, sum(total) as revenue from orders where created_at > now() - interval '7 days' group by 1 order by 3 desc" },
  output: {
    type: "table",
    columns: ["region", "orders", "revenue", "change"],
    rows: [
      ["North America", 4812, 612480, "+4.2%"],
      ["Europe", 3966, 498120, "+2.8%"],
      ["United Kingdom", 1542, 201350, "+1.1%"],
      ["Asia Pacific", 1210, 158900, "+6.5%"],
      ["Latin America", 684, 71220, "-0.8%"],
      ["Middle East", 402, 52310, "+3.3%"],
      ["Africa", 188, 19870, "+0.4%"],
      ["Oceania", 176, 22140, "+1.9%"],
    ],
  },
  durationMs: 640,
};

const SLACK: ToolCallData = {
  id: "slack",
  tool: "slack",
  title: "Posted a summary to #release",
  titles: { running: "Posting a summary to #release", approval: "Post a summary to #release" },
  status: "approval",
  input: { channel: "#release", unfurl_links: false },
  output: { type: "text", text: "Release 2.4 blockers: 4 open issues, 3 already in progress. Orders are up 3.1% week over week across every region except Latin America. Stripe confirmed the blank invoice PDF is a tax id edge case; fix lands in 2 days." },
  message: "Sends the four blockers and the regional totals to #release as one message.",
};

const pending = (call: ToolCallData): ToolCallData => ({ ...call, status: "running", output: undefined, durationMs: undefined, message: undefined });

/* ------------------------------------------------------------------------------------------ */
/* A scripted agent loop: calls are appended as they start and change status in place          */
/* ------------------------------------------------------------------------------------------ */

type Answer = "none" | "posted" | "skipped";

function useAgentRun() {
  const [calls, setCalls] = useState<ToolCallData[]>([]);
  const [working, setWorking] = useState(false);
  const [answer, setAnswer] = useState<Answer>("none");
  const [runId, setRunId] = useState(0);
  const timers = useRef<number[]>([]);

  const clear = useCallback(() => { timers.current.forEach(timer => window.clearTimeout(timer)); timers.current = []; }, []);
  const after = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  const patch = useCallback((id: string, next: Partial<ToolCallData>) => { setCalls(current => current.map(call => (call.id === id ? { ...call, ...next } : call))); }, []);
  const append = useCallback((call: ToolCallData) => { setCalls(current => [...current, call]); }, []);

  const start = useCallback(() => {
    clear();
    setCalls([]);
    setAnswer("none");
    setWorking(true);
    setRunId(id => id + 1);
    after(400, () => append(pending(WEB)));
    after(1700, () => patch(WEB.id, { status: "success", output: WEB.output, durationMs: WEB.durationMs }));
    after(2000, () => append(pending(GITHUB)));
    after(3200, () => patch(GITHUB.id, { status: "success", output: GITHUB.output, durationMs: GITHUB.durationMs }));
    after(3450, () => append(pending(GMAIL)));
    after(4400, () => patch(GMAIL.id, { status: "success", output: GMAIL.output, durationMs: GMAIL.durationMs }));
    after(4650, () => append(pending(POSTGRES)));
    after(6200, () => patch(POSTGRES.id, { status: "error", message: "Query timed out after 1.5s on the analytics replica.", durationMs: 1500 }));
  }, [after, append, clear, patch]);

  useEffect(() => { start(); return clear; }, [start, clear]);

  const retry = useCallback((call: ToolCallData) => {
    patch(call.id, { status: "running", message: undefined, durationMs: undefined });
    after(1300, () => {
      patch(call.id, { status: "success", output: POSTGRES.output, durationMs: POSTGRES.durationMs });
      after(400, () => append({ ...SLACK, output: undefined }));
    });
  }, [after, append, patch]);

  const approve = useCallback((call: ToolCallData) => {
    patch(call.id, { status: "running" });
    after(900, () => {
      patch(call.id, { status: "success", output: SLACK.output, durationMs: 420 });
      after(250, () => setWorking(false));
      after(900, () => setAnswer("posted"));
    });
  }, [after, patch]);

  const deny = useCallback((call: ToolCallData) => {
    patch(call.id, { status: "denied" });
    after(250, () => setWorking(false));
    after(900, () => setAnswer("skipped"));
  }, [after, patch]);

  return { calls, working, answer, runId, start, retry, approve, deny };
}

/* ------------------------------------------------------------------------------------------ */
/* Theme and accent                                                                            */
/* ------------------------------------------------------------------------------------------ */

const ACCENTS = ["neutral", "violet", "blue", "green", "coral"] as const;
type Accent = (typeof ACCENTS)[number];
const accentSwatch: Record<Accent, string> = { neutral: "oklch(50% 0 0)", violet: "#7747ff", blue: "#0562ef", green: "#0db879", coral: "#f15f55" };

function useTheme() {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark");
  const [accent, setAccent] = useState<Accent>(() => {
    const current = typeof document !== "undefined" ? document.documentElement.dataset.accent : undefined;
    return (ACCENTS as readonly string[]).includes(current ?? "") ? (current as Accent) : "neutral";
  });
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
    try { localStorage.setItem("arc-theme", dark ? "dark" : "light"); } catch { /* private mode */ }
  }, [dark]);
  useEffect(() => {
    document.documentElement.setAttribute("data-accent", accent);
    try { localStorage.setItem("arc-accent", accent); } catch { /* private mode */ }
  }, [accent]);
  return { dark, setDark, accent, setAccent };
}

/* ------------------------------------------------------------------------------------------ */
/* Page                                                                                        */
/* ------------------------------------------------------------------------------------------ */

const chip = "inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-(--border) bg-(--surface) px-3 text-sm font-medium text-(--foreground) transition-colors hover:bg-(--surface-muted)";

export default function App() {
  const { dark, setDark, accent, setAccent } = useTheme();
  const run = useAgentRun();
  const reduced = useReducedMotion() ?? false;
  const fade = { initial: reduced ? false : { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: motionTokens.duration.standard, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } };

  return (
    <div className="min-h-screen">
      <main className="mx-auto w-full max-w-[720px] px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[460px]">
            <h1 className="text-[1.75rem] font-medium leading-[1.1] tracking-[-0.03em] text-(--foreground)">Tool call</h1>
            <p className="mt-2 text-sm text-(--text-secondary)">
              A tool call row for agent transcripts: the tool's mark and the call in plain words, a live state while it runs, and the input and output a click away, with approval and retry when needed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-(--border) bg-(--surface) px-2.5" style={{ height: 36 }} role="radiogroup" aria-label="Accent">
              {ACCENTS.map(value => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={accent === value}
                  aria-label={`${value} accent`}
                  onClick={() => setAccent(value)}
                  className="grid size-5 place-items-center rounded-full"
                  style={{ boxShadow: accent === value ? `0 0 0 1.5px var(--background), 0 0 0 3px ${accentSwatch[value]}` : undefined }}
                >
                  <span className="block size-3.5 rounded-full" style={{ background: accentSwatch[value] }} />
                </button>
              ))}
            </div>
            <button type="button" className={chip} onClick={() => setDark(!dark)} aria-pressed={dark} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
              {dark ? <Sun size={16} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={16} strokeWidth={1.75} aria-hidden="true" />}
              <span className="hidden sm:inline">{dark ? "Light" : "Dark"}</span>
            </button>
          </div>
        </header>

        {/* Live preview: one assistant turn in a chat */}
        <section aria-labelledby="preview-title" className="rounded-[var(--radius-panel)] border border-(--border) bg-(--surface)" style={{ "--tool-call-ring": "var(--surface)" } as CSSProperties}>
          <div className="flex items-center justify-between gap-3 border-b border-(--border-subtle) px-5 py-3">
            <h2 id="preview-title" className="text-sm font-medium text-(--text-secondary)">Agent transcript</h2>
            <button type="button" className={chip} onClick={run.start}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
              Replay
            </button>
          </div>
          <div className="px-4 py-6 sm:px-6">
            <div className="flex justify-end">
              <p className="max-w-[80%] rounded-[20px] rounded-br-[8px] bg-(--surface-muted) px-4 py-2.5 text-sm text-(--foreground)">
                Which release blockers are still open? Check the numbers too, then post a summary to #release.
              </p>
            </div>

            <div className="mt-6 grid gap-2">
              <p className="px-2 text-sm text-(--foreground)">Let me check the open blockers and the data behind them.</p>

              <div key={run.runId}>
                {run.calls.length > 0 ? (
                  <ToolCallGroup calls={run.calls} active={run.working} onApprove={run.approve} onDeny={run.deny} onRetry={run.retry} />
                ) : (
                  <div className="h-10" aria-hidden="true" />
                )}
              </div>

              <AnimatePresence initial={false}>
                {run.answer !== "none" ? (
                  <motion.div key={run.answer} className="grid gap-3 px-2 pt-1 text-sm leading-6 text-(--foreground)" {...fade}>
                    <p>
                      Four release blockers are still open in <span className="font-medium">arc-ui/web</span>: the disabled checkout button after a coupon is removed (#1284), the blank invoice PDF without a VAT id (#1279), the command menu losing focus (#1271) and the Safari theme flash (#1266). Three of them already have Linear issues in progress.
                    </p>
                    <p>
                      Orders are up 3.1% week over week, led by Asia Pacific at +6.5%; Latin America is the only region down. Stripe confirmed the blank PDF is a tax id edge case with a fix due in two days.
                    </p>
                    <p className="text-(--text-secondary)">
                      {run.answer === "posted" ? "I posted this summary to #release." : "I did not post to #release. Tell me if you want it sent later."}
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* Single rows, one per status. Without handlers the row simulates the decision locally. */}
        <section aria-labelledby="states-title" className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-4 px-1">
            <h2 id="states-title" className="shrink-0 whitespace-nowrap text-sm font-medium text-(--text-secondary)">On its own</h2>
            <p className="text-right text-xs text-(--text-muted)">Allow, Deny and Retry are simulated here because no handler is passed.</p>
          </div>
          <div className="grid gap-1 rounded-[var(--radius-panel)] border border-(--border) bg-(--surface) p-2" style={{ "--tool-call-ring": "var(--surface)" } as CSSProperties}>
            <ToolCall {...WEB} id="solo-web" status="running" output={undefined} durationMs={undefined} />
            <ToolCall {...GITHUB} id="solo-github" />
            <ToolCall {...GMAIL} id="solo-gmail" defaultOpen />
            <ToolCall {...POSTGRES} id="solo-postgres" status="error" message="Query timed out after 1.5s on the analytics replica." durationMs={1500} />
            <ToolCall {...SLACK} id="solo-slack" />
            <ToolCall {...SLACK} id="solo-slack-denied" status="denied" />
            <ToolCall
              id="solo-files"
              tool={{ name: "Files", mark: <FileText size={16} strokeWidth={1.75} aria-hidden="true" /> }}
              title="Read release-notes.md"
              titles={{ running: "Reading release-notes.md" }}
              status="success"
              input={{ path: "docs/release-notes.md", lines: [1, 40] }}
              output={{ type: "text", text: "# Arc 2.4\n\n- Checkout: coupon removal re-enables the button\n- Billing: invoice PDF falls back to the customer name\n- Command menu keeps focus during slow searches" }}
              summary="3 changes"
              durationMs={88}
              renderOutput={call => {
                if (call.output?.type !== "text") return undefined;
                const [heading, ...rest] = call.output.text.split("\n").filter(Boolean);
                return (
                  <div className="grid gap-2 px-3 py-2.5">
                    <p className="text-sm font-medium text-(--foreground)">{heading.replace(/^#\s*/, "")}</p>
                    <ul className="grid gap-1 text-sm text-(--text-secondary)">
                      {rest.map(line => <li key={line} className="flex gap-2"><span aria-hidden="true" className="text-(--text-muted)">•</span>{line.replace(/^-\s*/, "")}</li>)}
                    </ul>
                  </div>
                );
              }}
            />
          </div>
        </section>

        <footer className="mt-10 px-1 text-xs text-(--text-muted)">
          <p>Brand marks are sample content and never imply endorsement. Built on Arc tokens: works in light and dark themes, with every accent, keyboard access and reduced motion.</p>
        </footer>
      </main>
    </div>
  );
}
