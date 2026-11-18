import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Brain, Bug, CircleAlert, FileText, Globe, PenLine, RotateCcw, Square, SquarePen, Upload, type LucideIcon } from "lucide-react";
import { CopyButton } from "../../copy-button";
import { TextShimmer } from "../../text-shimmer";
import { Tooltip } from "../../tooltip";
import { cx, tokens } from "../../tokens";
import { Composer, type ComposerDraft, type ComposerHandle } from "./composer";
import { FileGlyph, ModelMark, quick, tokenRanges } from "./parts";
import {
  effortLabels,
  sampleModels,
  sampleSuggestions,
  simulatedReply,
  thinkingMs,
  type ComposerMessage,
  type ComposerModel,
  type Effort,
  type Suggestion,
} from "./data";
import "./ai-composer.css";

export type { Attachment, ComposerMessage, ComposerModel, Effort, Suggestion } from "./data";
export { sampleModels, sampleSuggestions } from "./data";

const { spring, duration, ease } = tokens;

type Phase = "waiting" | "thinking" | "searching" | "writing" | "done" | "stopped" | "error";

type Turn = {
  id: number;
  message: ComposerMessage;
  model: ComposerModel;
  /** True when the reply comes from `onSend` as a live stream. */
  streamed: boolean;
  phase: Phase;
  source: string;
  sourceDone: boolean;
  shown: number;
  /** Start offsets of the revealed chunks; older ones merge into one text node. */
  chunks: number[];
  thoughtMs?: number;
  searched?: number;
  error?: string;
};

const isRunning = (phase: Phase) => phase === "waiting" || phase === "thinking" || phase === "searching" || phase === "writing";

const suggestionIcons: Record<NonNullable<Suggestion["icon"]>, LucideIcon> = { summary: FileText, draft: PenLine, bug: Bug };

/** Reveals whole words on the clock: about 80 words a second, faster when a live stream runs ahead. */
function reveal(turn: Turn, elapsed: number): Turn {
  const { source, shown } = turn;
  const waiting = source.length - shown;
  if (waiting <= 0) return turn.sourceDone ? { ...turn, phase: "done" } : turn;
  const rate = turn.streamed ? Math.max(480, waiting / 0.3) : 480;
  let next = Math.min(source.length, shown + Math.max(12, Math.round((rate * elapsed) / 1000)));
  if (next < source.length) {
    const space = source.slice(next).search(/\s/);
    if (space >= 0) {
      next += space;
      while (next < source.length && /\s/.test(source[next] ?? "")) next += 1;
    } else if (turn.sourceDone) {
      next = source.length;
    } else {
      const head = source.slice(0, next);
      next = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n")) + 1;
    }
  }
  if (next <= shown) return turn;
  const finished = next >= source.length && turn.sourceDone;
  return { ...turn, shown: next, chunks: [...turn.chunks, shown], phase: finished ? "done" : "writing" };
}

/** How full the ring around the stop button is, and how long it takes to get there. */
function ringProgress(turn: Turn | undefined): { progress: number | null; seconds: number } {
  if (!turn) return { progress: 0, seconds: 0 };
  if (turn.streamed) return { progress: isRunning(turn.phase) ? null : 1, seconds: 0.12 };
  const lead = turn.message.thinking || turn.message.webSearch ? 0.25 : 0.1;
  switch (turn.phase) {
    case "waiting":
      return { progress: lead, seconds: 0.65 };
    case "thinking":
      return { progress: turn.message.webSearch ? 0.14 : lead, seconds: thinkingMs[turn.message.effort] / 1000 };
    case "searching":
      return { progress: lead, seconds: 1.1 };
    case "writing":
      return { progress: lead + (1 - lead) * (turn.source.length ? turn.shown / turn.source.length : 0), seconds: 0.034 };
    default:
      return { progress: 1, seconds: 0.1 };
  }
}

function SentText({ text, tokens: tokenList }: { text: string; tokens: string[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of tokenRanges(text, tokenList)) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <span key={range.start} className="aic-sentToken">
        {range.text}
      </span>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function Sent({ turn, reduced }: { turn: Turn; reduced: boolean }) {
  const { message } = turn;
  return (
    <motion.div
      className="aic-sent"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: duration.instant } : { ...quick, opacity: { duration: duration.fast, ease: ease.standard } }}
    >
      {message.attachments.length > 0 && (
        <ul className="aic-sentFiles" aria-label="Attachments">
          {message.attachments.map((item) => (
            <li key={item.id} className="aic-sentFile" title={item.name}>
              <span className="aic-sentGlyph">
                <FileGlyph item={item} size="sm" />
              </span>
              <span className="aic-sentName">{item.name}</span>
            </li>
          ))}
        </ul>
      )}
      {message.text && (
        <p className="aic-bubble">
          <SentText text={message.text} tokens={message.tokens} />
        </p>
      )}
    </motion.div>
  );
}

/** The reply grows line by line on a short ease-out. */
function Grow({ children, reduced, reserve }: { children: ReactNode; reduced: boolean; reserve: boolean }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div className="aic-grow" initial={false} animate={{ height }} transition={reduced ? { duration: 0 } : { duration: duration.fast, ease: "easeOut" }}>
      <div ref={innerRef} className="aic-growInner" data-reserve={reserve || undefined}>
        {children}
      </div>
    </motion.div>
  );
}

function ReplyText({ turn, reduced }: { turn: Turn; reduced: boolean }) {
  const visible = turn.source.slice(0, turn.shown);
  const first = Math.max(0, turn.chunks.length - 6);
  const settled = turn.chunks.length ? (turn.chunks[first] ?? visible.length) : visible.length;
  return (
    <p className="aic-replyText" aria-busy={turn.phase === "writing" || undefined}>
      {visible.slice(0, settled)}
      {turn.chunks.slice(first).map((start, index) => {
        const end = turn.chunks[first + index + 1] ?? visible.length;
        return (
          <span key={start} className={reduced ? undefined : "aic-chunk"}>
            {visible.slice(start, end)}
          </span>
        );
      })}
    </p>
  );
}

function Reply({ turn, last, reduced, onRetry }: { turn: Turn; last: boolean; reduced: boolean; onRetry: () => void }) {
  const { phase, message } = turn;
  const steps: Array<{ id: string; icon: LucideIcon; active: boolean; label: string }> = [];

  if (message.thinking && !turn.streamed) {
    steps.push({
      id: "think",
      icon: Brain,
      active: phase === "thinking",
      label: phase === "thinking" ? "Thinking" : turn.thoughtMs ? `Thought for ${Math.max(1, Math.round(turn.thoughtMs / 1000))}s` : "Thinking stopped",
    });
  }
  if (message.webSearch && !turn.streamed) {
    const queued = phase === "thinking";
    steps.push({
      id: "search",
      icon: Globe,
      active: phase === "searching",
      label: phase === "searching" || queued ? "Searching the web" : turn.searched ? `Searched ${turn.searched} sites` : "Search stopped",
    });
  }

  const copyText = turn.source.slice(0, turn.shown).trim();
  const running = isRunning(phase);

  return (
    <motion.div className="aic-reply" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? duration.instant : duration.fast, ease: "easeOut" }}>
      <div className="aic-replyHead">
        <ModelMark mark={turn.model.mark} />
        <span>{turn.model.name}</span>
      </div>
      {steps.length > 0 && (
        <div className="aic-steps">
          {steps.map((step) => (
            <span key={step.id} className="aic-step" data-active={step.active || undefined} data-pending={(step.id === "search" && phase === "thinking") || undefined}>
              <step.icon className="aic-stepIcon" aria-hidden="true" />
              <TextShimmer active={step.active}>{step.label}</TextShimmer>
            </span>
          ))}
        </div>
      )}
      <Grow reduced={reduced} reserve={running}>
        {phase === "waiting" ? (
          <span className="aic-pending">
            <TextShimmer>Thinking</TextShimmer>
          </span>
        ) : turn.shown > 0 ? (
          <ReplyText turn={turn} reduced={reduced} />
        ) : null}
      </Grow>
      <AnimatePresence initial={false}>
        {!running && (
          <motion.div
            key="foot"
            className="aic-replyFoot"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? duration.instant : duration.fast, ease: "easeOut" }}
          >
            {phase === "stopped" && (
              <span className="aic-footStatus">
                <Square className="aic-footIcon" aria-hidden="true" />
                Stopped
              </span>
            )}
            {phase === "error" && (
              <span className="aic-footStatus" data-tone="error">
                <CircleAlert className="aic-footIcon" aria-hidden="true" />
                {turn.error ?? "The reply did not finish"}
              </span>
            )}
            {copyText && <CopyButton value={copyText} variant="plain" label="Copy reply" />}
            {last && (
              <Tooltip content="Run this message again">
                <button type="button" className="aic-footButton" onClick={onRetry}>
                  <RotateCcw aria-hidden="true" />
                  Retry
                </button>
              </Tooltip>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export type AiComposerProps = {
  /**
   * Called with every sent message. Return an async iterable of text deltas to stream a real reply;
   * Stop aborts `signal`. Return nothing and the preview plays a simulated reply.
   */
  onSend?: (message: ComposerMessage, options: { signal: AbortSignal }) => void | Promise<void> | AsyncIterable<string>;
  /** Display heading of the new chat state. */
  greeting?: string;
  /** Up to three starters under the composer. */
  suggestions?: Suggestion[];
  /** Models in the model menu. */
  models?: ComposerModel[];
  /** Id of the model selected at first. Defaults to the first model. */
  defaultModel?: string;
  placeholder?: string;
  /** Character limit. A ring counter appears at 80 percent. */
  maxLength?: number;
  className?: string;
};

export function AiComposer({
  onSend,
  greeting = "What should we work on?",
  suggestions = sampleSuggestions,
  models = sampleModels,
  defaultModel,
  placeholder = "Ask anything, / for commands, @ to add context",
  maxLength = 4000,
  className,
}: AiComposerProps) {
  const reduced = !!useReducedMotion();
  const [modelId, setModelId] = useState(defaultModel ?? models[0]?.id ?? "");
  const model = models.find((entry) => entry.id === modelId) ?? models[0] ?? sampleModels[0]!;
  const [effort, setEffort] = useState<Effort>(model.defaultEffort);
  const [webSearch, setWebSearch] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState("");
  const [dropping, setDropping] = useState(false);

  const composerRef = useRef<ComposerHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  const nextId = useRef(1);

  /* Repeating the same message still announces: a no-break space makes the text differ. */
  const announce = useCallback((message: string) => setStatus((current) => (current === message ? `${message}\u00a0` : message)), []);
  const patch = useCallback((id: number, update: (turn: Turn) => Turn) => setTurns((list) => list.map((turn) => (turn.id === id ? update(turn) : turn))), []);

  const current = turns[turns.length - 1];
  const busy = !!(current && isRunning(current.phase));
  const ring = ringProgress(current);
  const mode = turns.length ? "thread" : "new";

  /* Simulated steps before the first token: waiting, Extended thinking, Web search. */
  const stepKey = current && !current.streamed && isRunning(current.phase) && current.phase !== "writing" ? `${current.id}:${current.phase}` : "";
  useEffect(() => {
    if (!current || !stepKey) return;
    const { id, phase, message } = current;
    const wait = phase === "thinking" ? thinkingMs[message.effort] : phase === "searching" ? 1100 : 650;
    const timer = window.setTimeout(
      () =>
        patch(id, (turn) =>
          turn.phase !== phase
            ? turn
            : phase === "thinking"
              ? { ...turn, phase: message.webSearch ? "searching" : "writing", thoughtMs: wait }
              : phase === "searching"
                ? { ...turn, phase: "writing", searched: 6 }
                : { ...turn, phase: "writing" },
        ),
      wait,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  /* The reveal clock runs on animation frames only while a reply is writing. */
  const writingId = current?.phase === "writing" ? current.id : 0;
  useEffect(() => {
    if (!writingId) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last && now - last < 34) return;
      const elapsed = last ? Math.min(now - last, 100) : 34;
      last = now;
      setTurns((list) => {
        const index = list.findIndex((turn) => turn.id === writingId);
        const turn = list[index];
        if (!turn || turn.phase !== "writing") return list;
        const next = reveal(turn, elapsed);
        if (next === turn) return list;
        const copy = list.slice();
        copy[index] = next;
        return copy;
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [writingId]);

  async function consume(id: number, stream: AsyncIterable<string>, signal: AbortSignal) {
    try {
      for await (const delta of stream) {
        if (signal.aborted) return;
        patch(id, (turn) => ({ ...turn, source: turn.source + delta, phase: turn.phase === "waiting" ? "writing" : turn.phase }));
      }
      if (!signal.aborted) patch(id, (turn) => ({ ...turn, sourceDone: true, phase: turn.phase === "waiting" ? "done" : turn.phase }));
    } catch (error) {
      if (!signal.aborted)
        patch(id, (turn) => ({
          ...turn,
          phase: "error",
          sourceDone: true,
          shown: turn.source.length,
          error: error instanceof Error && error.message ? error.message : undefined,
        }));
    }
  }

  function send(message: ComposerMessage, replaceId?: number) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let result: ReturnType<NonNullable<AiComposerProps["onSend"]>> | undefined;
    try {
      result = onSend?.(message, { signal: controller.signal });
    } catch {
      result = undefined;
    }
    const stream = typeof result === "object" && result !== null && Symbol.asyncIterator in result ? (result as AsyncIterable<string>) : null;
    const replyModel = models.find((entry) => entry.id === message.model) ?? model;

    const turn: Turn = {
      id: nextId.current++,
      message,
      model: replyModel,
      streamed: !!stream,
      phase: stream ? "waiting" : message.thinking ? "thinking" : message.webSearch ? "searching" : "waiting",
      source: stream ? "" : simulatedReply(message.text),
      sourceDone: !stream,
      shown: 0,
      chunks: [],
    };

    stick.current = true;
    setTurns((list) => (replaceId ? list.map((entry) => (entry.id === replaceId ? turn : entry)) : [...list, turn]));
    announce(stream ? `Sent. ${replyModel.name} is replying` : `Sent. Simulated reply from ${replyModel.name}`);
    if (stream) void consume(turn.id, stream, controller.signal);
  }

  const phase = current?.phase;
  useEffect(() => {
    if (phase === "done") announce("Reply finished");
    else if (phase === "stopped") announce("Reply stopped");
    else if (phase === "error") announce("The reply did not finish");
  }, [phase, announce]);

  /* Keep the thread pinned to the newest text unless the reader scrolled up. */
  useEffect(() => {
    const thread = threadRef.current;
    const list = thread?.firstElementChild;
    if (!thread || !list) return;
    const observer = new ResizeObserver(() => {
      if (stick.current) thread.scrollTop = thread.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [mode]);

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  function newChat() {
    abortRef.current?.abort();
    setTurns([]);
    announce("New chat");
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function stop() {
    if (current && isRunning(current.phase)) {
      abortRef.current?.abort();
      patch(current.id, (turn) => ({ ...turn, phase: "stopped" }));
    }
  }

  function submit(draft: ComposerDraft) {
    send({ ...draft, files: draft.attachments.map((item) => item.name), model: model.id, effort, webSearch, thinking });
  }

  return (
    <section
      className={cx("aic-root", className)}
      aria-label="Chat"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDropping(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDropping(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDropping(false);
        composerRef.current?.addFiles(Array.from(event.dataTransfer.files));
        composerRef.current?.focus();
      }}
    >
      <AnimatePresence initial={false}>
        {mode === "thread" && (
          <motion.div
            key="new"
            className="aic-topBar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: duration.instant } }}
            transition={{ duration: duration.standard, delay: reduced ? 0 : 0.2 }}
          >
            <Tooltip content="New chat" side="left">
              <button type="button" className="aic-iconButton" aria-label="New chat" onClick={newChat}>
                <SquarePen aria-hidden="true" />
              </button>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="aic-stage" data-mode={mode}>
        {mode === "new" ? (
          <motion.div
            key="greeting"
            className="aic-intro"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.considered, ease: ease.enter }}
          >
            <h2 className="aic-greeting">{greeting}</h2>
          </motion.div>
        ) : (
          <div
            ref={threadRef}
            className="aic-thread"
            onScroll={(event) => {
              const node = event.currentTarget;
              stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
            }}
          >
            <ol className="aic-turns">
              {turns.map((turn, index) => (
                <li key={turn.id} className="aic-turn">
                  <Sent turn={turn} reduced={reduced} />
                  <Reply turn={turn} last={index === turns.length - 1} reduced={reduced} onRetry={() => send(turn.message, turn.id)} />
                </li>
              ))}
            </ol>
          </div>
        )}

        <motion.div className="aic-dock" layout={reduced ? false : "position"} layoutDependency={mode} transition={spring.smooth}>
          <Composer
            ref={composerRef}
            models={models}
            model={model}
            effort={effort}
            webSearch={webSearch}
            thinking={thinking}
            onModel={(id) => {
              const picked = models.find((entry) => entry.id === id);
              if (!picked) return;
              setModelId(id);
              announce(`${picked.name} selected`);
            }}
            onEffort={(value) => {
              setEffort(value);
              announce(`${effortLabels[value]} effort`);
            }}
            onTool={(tool) => {
              if (tool === "search") {
                setWebSearch((on) => !on);
                announce(webSearch ? "Web search off" : "Web search on");
              } else {
                setThinking((on) => !on);
                announce(thinking ? "Extended thinking off" : "Extended thinking on");
              }
            }}
            busy={busy}
            progress={ring.progress}
            progressSeconds={ring.seconds}
            run={current?.id ?? 0}
            placeholder={placeholder}
            maxLength={maxLength}
            reduced={reduced}
            onSubmit={submit}
            onStop={stop}
            announce={announce}
          />
        </motion.div>

        {mode === "new" && suggestions.length > 0 && (
          <motion.ul
            key="suggestions"
            className="aic-suggestions"
            aria-label="Suggestions"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.considered, ease: ease.enter, delay: reduced ? 0 : 0.06 }}
          >
            {suggestions.slice(0, 3).map((suggestion) => {
              const Icon = suggestion.icon ? suggestionIcons[suggestion.icon] : null;
              return (
                <li key={suggestion.id}>
                  <button type="button" className="aic-suggestion" onClick={() => composerRef.current?.fill(suggestion.prompt)}>
                    {Icon && <Icon className="aic-suggestionIcon" aria-hidden="true" />}
                    {suggestion.label}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </div>

      <AnimatePresence>
        {dropping && (
          <motion.div key="drop" className="aic-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.fast }}>
            <motion.span className="aic-dropInner" initial={reduced ? false : { y: 6 }} animate={{ y: 0 }} transition={reduced ? { duration: 0 } : quick}>
              <Upload className="aic-dropIcon" aria-hidden="true" />
              <span className="aic-dropTitle">Drop files to attach</span>
              <span className="aic-dropNote">PDFs, images, code and text, up to 30 MB each</span>
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="aic-srOnly" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

export default AiComposer;
