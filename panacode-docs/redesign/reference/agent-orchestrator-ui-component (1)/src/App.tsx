import { useEffect, useState } from "react";
import { AgentOrchestrator } from "./components/agent-orchestrator";
import type { OrchestratorResult } from "./components/agent-orchestrator";

function useTheme() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return [dark, () => setDark(d => !d)] as const;
}

export default function App() {
  const [dark, toggle] = useTheme();
  const [last, setLast] = useState<OrchestratorResult | null>(null);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg px-4 py-8 text-fg sm:px-8 sm:py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-70"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, color-mix(in oklab, var(--s2) 12%, transparent), transparent 70%), radial-gradient(40% 80% at 15% 0%, color-mix(in oklab, var(--s1) 10%, transparent), transparent 70%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-[1120px]">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg3">Blocks · Agents</p>
            <h1 className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">Agent orchestrator</h1>
            <p className="mt-2 max-w-xl text-pretty text-[15px] leading-relaxed text-fg2">
              A lead agent splits a goal into a plan, fans the subtasks out to parallel worker lanes and merges what comes back. Change
              the lane limit mid-run, or click a lane to open its transcript.
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={dark}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong bg-card text-fg2 outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
          >
            {dark ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                <circle cx="8" cy="8" r="2.8" />
                <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
              </svg>
            )}
          </button>
        </div>

        <AgentOrchestrator onComplete={setLast} />

        <p className="mt-5 min-h-5 text-center text-xs text-fg3" aria-live="off">
          {last
            ? `Last run: ${last.tokens.toLocaleString("en-US")} tokens · $${last.cost.toFixed(4)} · ${(last.wallMs / 1000).toFixed(1)}s wall, ${last.speedup.toFixed(1)}× faster than in sequence`
            : "Company names, prices and pages in the sample are fictional. Prices for non-Anthropic models are illustrative."}
        </p>
      </div>
    </div>
  );
}
