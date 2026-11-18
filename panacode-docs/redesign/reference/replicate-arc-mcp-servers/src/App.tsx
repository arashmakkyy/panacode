import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { McpServers } from "@/components/arc/blocks/mcp-servers/mcp-servers";

type Theme = "light" | "dark";

const readTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/**
 * The host page: the block on a plain canvas, nothing else. With no props it runs the simulated demo with sample
 * servers; pass `servers` and the callbacks to wire a real MCP client.
 */
export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("arc-theme", theme);
    } catch {
      /* Storage can be unavailable; the theme still applies for this visit. */
    }
  }, [theme]);

  const next = theme === "dark" ? "light" : "dark";

  return (
    <main className="grid min-h-dvh content-start justify-items-center px-[clamp(16px,4vw,54px)] pt-[clamp(56px,9vh,96px)] pb-[clamp(24px,6vh,72px)]">
      <button
        type="button"
        onClick={() => setTheme(next)}
        aria-label={`Switch to ${next} theme`}
        title={`Switch to ${next} theme`}
        className="fixed top-3 right-3 z-20 grid size-9 cursor-pointer place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition-colors duration-150 hover:text-[var(--foreground)]"
      >
        {theme === "dark" ? <Sun size={16} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={16} strokeWidth={1.75} aria-hidden="true" />}
      </button>

      <McpServers />
    </main>
  );
}
