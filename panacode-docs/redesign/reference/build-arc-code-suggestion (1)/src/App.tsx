import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { CodeSuggestionDemo } from "./components/arc/code-suggestion/code-suggestion-demo";

type Theme = "light" | "dark";

export default function App() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const nextTheme: Theme = theme === "light" ? "dark" : "light";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1040px] flex-col justify-center px-2 py-4 sm:px-8 sm:py-8">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          className="theme-toggle"
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
          onClick={() => setTheme(nextTheme)}
        >
          {theme === "light" ? (
            <Moon size={15} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Sun size={15} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </div>

      <section className="preview-canvas" aria-label="Code suggestion preview">
        <div className="preview-stage">
          <CodeSuggestionDemo />
        </div>
      </section>
    </main>
  );
}
