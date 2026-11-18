import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight, Eye, Moon, Scan, Smartphone, Sun } from "lucide-react";
import { AgentApprovals } from "@/components/arc/blocks/agent-approvals/agent-approvals";
import { T } from "@/components/arc/motion";
import styles from "./app.module.css";

type Theme = "light" | "dark";
type Size = "fit" | "mobile";

function readTheme(): Theme {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("arc-theme") : null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [size, setSize] = useState<Size>("fit");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("arc-theme", theme);
    } catch {
      /* storage can be unavailable */
    }
  }, [theme]);

  const sizes: Array<{ id: Size; label: string; icon: typeof Scan }> = [
    { id: "fit", label: "Fit", icon: Scan },
    { id: "mobile", label: "Mobile", icon: Smartphone },
  ];

  return (
    <main className={styles.main}>
      <article className={styles.doc}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <span className={styles.crumb}>
            <a href="#preview">Blocks</a>
            <ChevronRight size={13} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span aria-current="page">Agent approvals</span>
        </nav>

        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <div className={styles.titleRow}>
              <h1>Agent approvals</h1>
              <span className={styles.badge}>
                <span className={styles.badgeLabel}>Pro</span>
              </span>
            </div>
            <p>
              One approval card for agents: the waiting tool call reads like a permission prompt with the tool&apos;s
              mark, the agent&apos;s reason and its arguments, and you approve, deny or allow it from now on.
            </p>
          </div>
        </header>

        <section id="preview" className={styles.previewSection} aria-label="Preview">
          <div className={styles.viewBar}>
            <div className={styles.viewTabs} role="tablist" aria-label="Agent approvals preview">
              <button type="button" role="tab" aria-selected="true">
                <span>
                  <Eye size={14} strokeWidth={1.8} aria-hidden="true" />
                  Preview
                </span>
                <i className={styles.viewIndicator} />
              </button>
            </div>
            <div className={styles.viewTools}>
              <span className={styles.viewHint}>Live block · sample data</span>
              <div className={styles.tools}>
                <div className={styles.switch} role="radiogroup" aria-label="Preview size">
                  {sizes.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={size === id}
                      aria-label={label}
                      title={label}
                      tabIndex={size === id ? 0 : -1}
                      className={styles.option}
                      onClick={() => setSize(id)}
                      onKeyDown={(event) => {
                        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                          event.preventDefault();
                          const next = size === "fit" ? "mobile" : "fit";
                          setSize(next);
                          const group = event.currentTarget.parentElement;
                          requestAnimationFrame(() =>
                            group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(),
                          );
                        }
                      }}
                    >
                      {size === id && (
                        <motion.span
                          layoutId="preview-size-highlight"
                          className={styles.highlight}
                          transition={reduced ? { duration: 0 } : T.spring.snappy}
                        />
                      )}
                      <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                  aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  title={theme === "dark" ? "Light theme" : "Dark theme"}
                >
                  {theme === "dark" ? (
                    <Sun size={14} strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <Moon size={14} strokeWidth={1.8} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className={styles.canvas}>
            <div className={styles.shell} data-mode={size}>
              <div className={styles.bezel} aria-hidden="true" />
              <div className={styles.fitLayer}>
                <AgentApprovals />
              </div>
            </div>
          </div>
        </section>
      </article>
    </main>
  );
}
