import type {
  OrchestratorEvent,
  OrchestratorLead,
  OrchestratorRunContext,
  OrchestratorSubtask,
  OrchestratorWorker,
} from "./types";

/** Time a dispatch packet takes to reach its lane. The simulation waits for it before work starts. */
export const PACKET_MS = 460;

export const sampleGoal = "Compare our pricing page with four competitors and suggest changes";

export const samplePlan: OrchestratorSubtask[] = [
  {
    id: "our-page",
    title: "Audit our pricing page",
    instruction: "Read our current tiers, limits and calls to action",
    workerId: "sonnet",
  },
  {
    id: "tiers",
    title: "Scan competitor tiers",
    instruction: "Pull list prices and plan names from Northwind and Lumen",
    workerId: "haiku",
  },
  {
    id: "trials",
    title: "Compare free tiers and trials",
    instruction: "Check how Orbit and Fathom handle trials and free seats",
    workerId: "gemini",
  },
  {
    id: "reviews",
    title: "Mine pricing reviews",
    instruction: "Find what buyers say about overage fees and limits",
    workerId: "luna",
  },
];

export const sampleWorkers: OrchestratorWorker[] = [
  { id: "sonnet", name: "Claude Sonnet 5.5" },
  { id: "haiku", name: "Claude Haiku 5.5" },
  { id: "gemini", name: "Gemini 3.8 Flash" },
  { id: "luna", name: "GPT-6 Luna" },
];

export const sampleLead: OrchestratorLead = { name: "Claude Opus 5.5" };

/** USD per million tokens [input, output]. Claude prices are list prices, the rest are illustrative. */
const PRICES: Record<string, [number, number]> = {
  lead: [5, 25],
  sonnet: [3, 15],
  haiku: [1, 5],
  gemini: [0.3, 2.5],
  luna: [1.25, 10],
};
const DEFAULT_PRICE: [number, number] = [2, 10];

interface Step {
  tool: string;
  target: string;
  note: string;
  found: string;
  tin: number;
  tout: number;
  ms: number;
  /** fail once with a 503 and retry after two seconds */
  flaky?: boolean;
}

const SCRIPTS: Record<string, { steps: Step[]; result: string }> = {
  "our-page": {
    steps: [
      {
        tool: "read_file",
        target: "app/pricing/page.tsx",
        note: "Three tiers, annual toggle sits below the fold",
        found: "3 tiers · 212 lines",
        tin: 2480,
        tout: 310,
        ms: 900,
      },
      {
        tool: "read_file",
        target: "content/plans.ts",
        note: "Team is $24 a seat, overage copy is one footnote",
        found: "Limits and overage copy",
        tin: 1860,
        tout: 270,
        ms: 800,
      },
      {
        tool: "write_findings",
        target: "findings/our-pricing.md",
        note: "Writing up anchors, hidden savings and weak limits copy",
        found: "Saved 4 findings",
        tin: 1240,
        tout: 520,
        ms: 1000,
      },
    ],
    result: "Three tiers, annual saving hidden below the fold, overage fees only in a footnote.",
  },
  tiers: {
    steps: [
      {
        tool: "web_search",
        target: "northwind lumen pricing per seat",
        note: "Two direct rivals ranked, both list prices public",
        found: "8 results",
        tin: 980,
        tout: 190,
        ms: 800,
      },
      {
        tool: "fetch_page",
        target: "northwind.example/pricing",
        note: "Northwind charges $19 a seat and shows the annual price first",
        found: "Plans and limits table",
        tin: 3120,
        tout: 380,
        ms: 1150,
      },
      {
        tool: "fetch_page",
        target: "lumen.example/pricing",
        note: "Lumen charges $29 and puts a savings badge next to the price",
        found: "Plans and limits table",
        tin: 2890,
        tout: 360,
        ms: 1050,
      },
      {
        tool: "write_findings",
        target: "findings/tiers.md",
        note: "Both rivals lead with the annual saving",
        found: "Saved 3 findings",
        tin: 1100,
        tout: 440,
        ms: 850,
      },
    ],
    result: "Northwind $19, Lumen $29. Both show the annual saving right beside the price.",
  },
  trials: {
    steps: [
      {
        tool: "web_search",
        target: "orbit fathom free trial no card",
        note: "Looking for trial length and card requirements",
        found: "6 results",
        tin: 870,
        tout: 160,
        ms: 750,
      },
      {
        tool: "fetch_page",
        target: "orbit.example/plans",
        note: "Orbit gives 14 days with no card, free tier capped at 3 seats",
        found: "Plans page",
        tin: 2640,
        tout: 340,
        ms: 1100,
        flaky: true,
      },
      {
        tool: "write_findings",
        target: "findings/trials.md",
        note: "A no-card trial is the one clear gap on our page",
        found: "Saved 2 findings",
        tin: 980,
        tout: 380,
        ms: 800,
      },
    ],
    result: "Orbit offers 14 days with no card and a 3-seat free tier. We ask for a card up front.",
  },
  reviews: {
    steps: [
      {
        tool: "web_search",
        target: "saas pricing complaints overage fees",
        note: "Collecting review threads from the last year",
        found: "12 threads",
        tin: 1120,
        tout: 210,
        ms: 850,
      },
      {
        tool: "fetch_page",
        target: "reviews.example/northwind",
        note: "Buyers praise plain limits and dislike surprise overage",
        found: "41 reviews",
        tin: 3380,
        tout: 420,
        ms: 1200,
      },
      {
        tool: "write_findings",
        target: "findings/reviews.md",
        note: "Overage surprise is the most common complaint",
        found: "Saved 3 findings",
        tin: 1010,
        tout: 400,
        ms: 800,
      },
    ],
    result: "Buyers like clear limits. Most complaints are about surprise overage fees.",
  },
};

const SUMMARY =
  "Our pricing page leads with three tiers but hides the annual saving that both Northwind and Lumen show beside the price. " +
  "Orbit's no-card trial and the reviewers' complaints about overage fees point to the same fix: show the annual price first, " +
  "state limits in plain words and offer a trial without a card. Start with the Team plan label and price anchor, then test the overage copy.";

/* ───────── helpers ───────── */

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function channel<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(item: T) {
      if (closed) return;
      queue.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (queue.length) yield queue.shift() as T;
        if (closed) return;
        await new Promise<void>(r => (wake = r));
        wake = null;
      }
    },
  };
}

const jitter = (ms: number) => Math.round(ms * (0.88 + Math.random() * 0.24));

function genericScript(subtask: OrchestratorSubtask) {
  const steps: Step[] = [
    { tool: "web_search", target: subtask.title.toLowerCase(), note: "Searching for sources", found: "6 results", tin: 900, tout: 180, ms: 800 },
    { tool: "fetch_page", target: "example.com/source", note: "Reading the most relevant page", found: "1 page", tin: 2400, tout: 320, ms: 1000 },
    { tool: "write_findings", target: "findings.md", note: "Writing up what was found", found: "Saved findings", tin: 900, tout: 360, ms: 800 },
  ];
  return { steps, result: `Finished: ${subtask.title}.` };
}

/** Streams `text` as short chunks of a few words, newLine on the first. */
async function streamNote(
  push: (e: OrchestratorEvent) => void,
  subtaskId: string,
  text: string,
  signal: AbortSignal,
) {
  const words = text.split(" ");
  for (let i = 0, first = true; i < words.length; i += 2, first = false) {
    if (signal.aborted) return;
    const delta = (first ? "" : " ") + words.slice(i, i + 2).join(" ");
    push({ type: "output", subtaskId, delta, newLine: first });
    await sleep(jitter(120), signal);
  }
}

/**
 * The default run hook. Plans four subtasks, dispatches them up to the live concurrency limit,
 * runs each lane through scripted tool calls, fails one fetch with a 503 and retries it after
 * two seconds, then streams the lead's summary.
 */
export async function* simulateOrchestration(context: OrchestratorRunContext): AsyncGenerator<OrchestratorEvent> {
  const { plan, workers, concurrency, signal } = context;
  const ch = channel<OrchestratorEvent>();
  const push = (e: OrchestratorEvent) => ch.push(e);

  const priceFor = (subtask: OrchestratorSubtask, index: number) => {
    const w = (subtask.workerId && workers.find(x => x.id === subtask.workerId)) || workers[index % Math.max(1, workers.length)];
    return (w && PRICES[w.id]) || DEFAULT_PRICE;
  };

  const runLane = async (subtask: OrchestratorSubtask, index: number) => {
    const script = SCRIPTS[subtask.id] ?? genericScript(subtask);
    const [pin, pout] = priceFor(subtask, index);
    const id = subtask.id;
    await sleep(PACKET_MS, signal); // wait for the packet to land
    for (const step of script.steps) {
      if (signal.aborted) return;
      const attempts = step.flaky ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        push({ type: "tool", subtaskId: id, tool: step.tool, target: step.target });
        push({ type: "usage", subtaskId: id, tokens: step.tin, cost: (step.tin * pin) / 1e6 });
        await sleep(jitter(step.ms * 0.55), signal);
        if (step.flaky && attempt === 0) {
          await sleep(300, signal);
          if (signal.aborted) return;
          push({ type: "error", subtaskId: id, message: "503 Service Unavailable", retryInMs: 2000 });
          await sleep(2000, signal);
          if (signal.aborted) return;
          push({ type: "retry", subtaskId: id });
          continue;
        }
        await streamNote(push, id, step.note, signal);
        await sleep(jitter(step.ms * 0.2), signal);
        push({ type: "usage", subtaskId: id, tokens: step.tout, cost: (step.tout * pout) / 1e6 });
        push({ type: "toolResult", subtaskId: id, summary: step.found });
        await sleep(120, signal);
      }
    }
    if (signal.aborted) return;
    push({ type: "result", subtaskId: id, text: script.result });
  };

  const orchestrate = async () => {
    // 1. Plan, one subtask at a time. The lead's own tokens count toward the totals.
    await sleep(450, signal);
    push({ type: "usage", tokens: 1840, cost: (1500 * PRICES.lead[0] + 340 * PRICES.lead[1]) / 1e6 });
    for (const subtask of plan) {
      if (signal.aborted) return;
      push({ type: "plan", subtask });
      await sleep(Math.min(760, 280 + (subtask.instruction?.split(" ").length ?? 4) * 45), signal);
    }
    await sleep(300, signal);

    // 2. Fan out, respecting the live concurrency limit.
    const queue = plan.map((subtask, index) => ({ subtask, index }));
    const running: Promise<void>[] = [];
    let active = 0;
    while (queue.length) {
      if (signal.aborted) return;
      if (active < Math.max(1, concurrency())) {
        const { subtask, index } = queue.shift()!;
        active++;
        push({ type: "dispatch", subtaskId: subtask.id });
        running.push(
          runLane(subtask, index).finally(() => {
            active--;
          }),
        );
        await sleep(150, signal);
      } else {
        await sleep(80, signal);
      }
    }
    await Promise.all(running);
    if (signal.aborted) return;

    // 3. Fan in: let the last packet land, then stream the summary.
    await sleep(PACKET_MS + 60, signal);
    const [lin, lout] = PRICES.lead;
    push({ type: "usage", tokens: 2960, cost: (2300 * lin + 660 * lout) / 1e6 });
    const words = SUMMARY.split(" ");
    for (let i = 0; i < words.length; i += 3) {
      if (signal.aborted) return;
      push({ type: "summary", delta: (i ? " " : "") + words.slice(i, i + 3).join(" ") });
      await sleep(jitter(85), signal);
    }
    await sleep(240, signal);
    push({ type: "done" });
  };

  const finished = orchestrate().finally(() => ch.close());
  try {
    yield* ch;
  } finally {
    await finished.catch(() => undefined);
  }
}
