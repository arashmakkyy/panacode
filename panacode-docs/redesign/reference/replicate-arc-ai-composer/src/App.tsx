import { useEffect } from "react";
import { AiComposer } from "./components/arc/blocks/ai-composer/ai-composer";

/** Follows the system appearance, the way Arc does when no theme was chosen. */
function useSystemTheme() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = query.matches ? "dark" : "light";
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
}

export default function App() {
  useSystemTheme();

  return (
    <main className="page">
      <AiComposer />
    </main>
  );
}
