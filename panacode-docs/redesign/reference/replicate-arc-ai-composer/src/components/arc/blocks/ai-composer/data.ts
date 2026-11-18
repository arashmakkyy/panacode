export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ComposerModel = {
  id: string;
  name: string;
  short: string;
  note: string;
  mark: "claude" | "openai" | "gemini";
  defaultEffort: Effort;
};

export type Suggestion = {
  id: string;
  label: string;
  prompt: string;
  icon?: "summary" | "draft" | "bug";
};

export type AttachmentKind = "pdf" | "code" | "sheet" | "doc" | "image" | "archive" | "text";

export type Attachment = {
  id: string;
  source: "file" | "drive" | "github" | "screenshot" | "paste";
  kind: AttachmentKind;
  name: string;
  meta: string;
  size: number;
  status: "uploading" | "done" | "ready" | "error";
  progress: number;
  error?: string;
  thumb?: string;
  /** The real File for picked, dropped or pasted files. */
  file?: File;
  /** The pasted text for pasted text chips. */
  text?: string;
};

export type ComposerMessage = {
  text: string;
  /** The commands and mentions in the text. */
  tokens: string[];
  attachments: Attachment[];
  files: string[];
  model: string;
  effort: Effort;
  webSearch: boolean;
  thinking: boolean;
};

export type ComposerCommand = { id: string; label: string; hint: string };

export type ComposerContext = {
  id: string;
  label: string;
  group: "Files" | "Docs";
  meta: string;
  kind: "code" | "sheet" | "pdf" | "notion" | "linear" | "figma";
};

export const efforts: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export const effortLabels: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Xhigh",
  max: "Max",
};

export const effortHints: Record<Effort, string> = {
  low: "Fastest replies",
  medium: "Balanced",
  high: "More careful",
  xhigh: "Deeper reasoning",
  max: "Most thorough, slowest",
};

/** How long the simulated Extended thinking step runs, by effort. */
export const thinkingMs: Record<Effort, number> = { low: 900, medium: 1200, high: 1500, xhigh: 1800, max: 2200 };

export const sampleModels: ComposerModel[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", short: "Opus 5.5", note: "Flagship for complex work", mark: "claude", defaultEffort: "medium" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", short: "Sonnet 5.5", note: "Everyday coding and agents", mark: "claude", defaultEffort: "high" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", short: "Haiku 5.5", note: "Fastest for quick answers", mark: "claude", defaultEffort: "medium" },
  { id: "gpt-6-1-sol", name: "GPT-6.1 Sol", short: "GPT-6.1 Sol", note: "OpenAI, released Sep 29", mark: "openai", defaultEffort: "medium" },
  { id: "gemini-4-argon", name: "Gemini 4 Argon", short: "Gemini 4", note: "Google, 2M context", mark: "gemini", defaultEffort: "medium" },
];

export const sampleCommands: ComposerCommand[] = [
  { id: "summarize", label: "/summarize", hint: "Condense text or a file into key points" },
  { id: "translate", label: "/translate", hint: "Translate into another language" },
  { id: "explain", label: "/explain", hint: "Walk through code or an idea step by step" },
  { id: "fix", label: "/fix", hint: "Find and fix a bug in the code" },
];

export const sampleContexts: ComposerContext[] = [
  { id: "checkout", label: "checkout.tsx", group: "Files", meta: "src/app/checkout", kind: "code" },
  { id: "pricing", label: "pricing-q4.csv", group: "Files", meta: "data/finance", kind: "sheet" },
  { id: "guidelines", label: "brand-guidelines.pdf", group: "Files", meta: "Design, 4.8 MB", kind: "pdf" },
  { id: "launch", label: "Q4 launch plan", group: "Docs", meta: "Notion, edited Oct 18", kind: "notion" },
  { id: "retries", label: "Checkout retries", group: "Docs", meta: "Linear, ENG-2481", kind: "linear" },
  { id: "flow", label: "Checkout flow v3", group: "Docs", meta: "Figma, edited Oct 16", kind: "figma" },
];

export const sampleSuggestions: Suggestion[] = [
  { id: "launch", label: "Summarize the Q4 launch plan", prompt: "/summarize @Q4 launch plan and list the open risks", icon: "summary" },
  { id: "reply", label: "Draft a reply to Priya", prompt: "Draft a short reply to Priya about the annual discount on the Team plan", icon: "draft" },
  { id: "bug", label: "Explain the checkout retry bug", prompt: "/explain why @checkout.tsx can charge a card twice on a slow network", icon: "bug" },
];

/** Every token the composer knows: commands and @mentions. */
export const knownTokens = [...sampleCommands.map((command) => command.label), ...sampleContexts.map((context) => `@${context.label}`)];

export const dictationTranscript =
  "Move the launch review to Thursday, October 29, and ask Priya to bring the updated pricing numbers.";

/** The reply the preview plays when `onSend` returns nothing. */
export function simulatedReply(text: string) {
  const t = text.toLowerCase();
  if (t.startsWith("/summarize") || t.includes("launch plan"))
    return "The Q4 launch moves the self-serve tier to November 12, with the new pricing landing a week earlier on November 5. The main open risk is the checkout migration, which still needs a load test before the code freeze on October 30.";
  if (t.includes("launch post") || t.includes("pricing page"))
    return "Here is a draft: “Our new pricing page is live. Every plan now shows exactly what you get, annual billing saves 20 percent, and you can switch plans any time without talking to sales.” Want a shorter version for X?";
  if (t.startsWith("/translate"))
    return "Hier ist die Übersetzung: Wir verschieben das Launch-Review auf Donnerstag, den 29. Oktober. Bitte bring die aktualisierten Preiszahlen mit.";
  if (t.startsWith("/fix"))
    return "The retry in submitPayment builds a new idempotency key on every attempt, so the processor treats each retry as a fresh charge. Create the key once per checkout and pass it to every retry, then cap retries at three with backoff.";
  if (t.startsWith("/explain") || t.includes("checkout"))
    return "When the first request times out, checkout.tsx retries the payment without the original idempotency key, so a slow network can produce a second charge. Reusing that key on every retry makes the processor return the first result instead of charging again.";
  if (t.includes("priya") || t.includes("reply") || t.includes("draft"))
    return "Here is a draft: “Thanks for the detailed notes, Priya. We will keep the annual discount on the Team plan at 20 percent and revisit seat minimums after the November 12 review.”";
  if (t.includes("thursday") || t.includes("october 29"))
    return "I moved the launch review to Thursday, October 29 at 10:00 and sent Priya a note asking for the updated pricing numbers. The invite now links the Q4 launch plan so everyone opens the same version.";
  return "Here is where I would start: name the decision you need, then list the facts that support it and the questions still open. Add a file with the plus button or mention a doc with @, and I can work from the real details.";
}

/** A tiny dashboard drawn as SVG, used as the simulated screenshot thumbnail. */
export const screenshotThumb = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#f4f4f5"/><rect x="0" y="0" width="96" height="12" fill="#e4e4e7"/><circle cx="7" cy="6" r="2" fill="#d4d4d8"/><circle cx="13" cy="6" r="2" fill="#d4d4d8"/><rect x="0" y="12" width="22" height="84" fill="#fafafa"/><rect x="5" y="20" width="12" height="3" rx="1.5" fill="#d4d4d8"/><rect x="5" y="28" width="12" height="3" rx="1.5" fill="#d4d4d8"/><rect x="5" y="36" width="12" height="3" rx="1.5" fill="#d4d4d8"/><rect x="30" y="20" width="40" height="5" rx="2.5" fill="#a1a1aa"/><rect x="30" y="32" width="58" height="26" rx="4" fill="#ffffff"/><rect x="35" y="46" width="6" height="8" rx="1" fill="#71717a"/><rect x="44" y="41" width="6" height="13" rx="1" fill="#71717a"/><rect x="53" y="44" width="6" height="10" rx="1" fill="#71717a"/><rect x="62" y="37" width="6" height="17" rx="1" fill="#3f3f46"/><rect x="71" y="43" width="6" height="11" rx="1" fill="#71717a"/><rect x="30" y="64" width="27" height="22" rx="4" fill="#ffffff"/><rect x="61" y="64" width="27" height="22" rx="4" fill="#ffffff"/></svg>',
)}`;
