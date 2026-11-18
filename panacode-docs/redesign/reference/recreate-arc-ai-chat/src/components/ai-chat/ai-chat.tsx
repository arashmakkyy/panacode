import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code as CodeIcon,
  Copy,
  Database,
  File as FileIcon,
  Globe,
  LoaderCircle,
  Paperclip,
  Pencil,
  RotateCcw,
  Search,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Timer,
  X,
} from "lucide-react";
import s from "./chat.module.css";
import { FENCE, Markdown, hostOf } from "./markdown";
import {
  DEMO_FOLLOW_UP,
  DEMO_PROMPT,
  createSampleResponder,
  sampleHistory,
  sampleModels,
  sampleSuggestions,
  titleFor,
} from "./sample";
import type {
  AiChatMessage,
  AiChatProps,
  ChatAttachment,
  ChatModel,
  ChatSource,
  ChatTool,
} from "./types";
import {
  Button,
  EASE,
  FOLD,
  FOLD_SLOW,
  IconSwap,
  Swap,
  TextShimmer,
  Tooltip,
  copyText,
  cx,
  useGlideHeight,
} from "./ui";

/* ----------------------------------------------------------------- model */

type Feedback = "up" | "down" | null;

interface Reply {
  id: string;
  model: string;
  status: "thinking" | "streaming" | "done" | "stopped" | "error";
  /** Everything received so far. */
  text: string;
  /** How much of `text` is on screen. */
  shown: number;
  /** Offsets where each revealed chunk began; cleared once the reply settles. */
  marks?: number[];
  streamDone: boolean;
  reasoning: string;
  thoughtFor?: number;
  tools: ChatTool[];
  sources: ChatSource[];
  feedback: Feedback;
  error?: string;
}

interface Version {
  id: string;
  prompt: string;
  attachments?: ChatAttachment[];
  reply: Reply;
  /** The turn that followed this version. */
  next: string | null;
}

interface Turn {
  id: string;
  versions: Version[];
  active: number;
}

interface Thread {
  root: string | null;
  turns: Record<string, Turn>;
}

interface Chat {
  id: string;
  title: string;
  group: string;
  thread: Thread;
}

interface StreamRef {
  controller: AbortController;
  chatId: string;
  turnId: string;
  versionId: string;
  started: number;
}

interface TurnActions {
  retry: (turnId: string) => void;
  edit: (turnId: string, prompt: string) => void;
  retryInPlace: (turnId: string, versionId: string) => void;
  select: (turnId: string, index: number) => void;
  feedback: (turnId: string, versionId: string, value: "up" | "down") => void;
  copied: (ok: boolean) => void;
}

const EMPTY_THREAD: Thread = { root: null, turns: {} };
const DEMO_ID = "chat-demo";

let serial = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(serial++).toString(36)}`;

function newReply(id: string, model: string): Reply {
  return {
    id,
    model,
    status: "thinking",
    text: "",
    shown: 0,
    streamDone: false,
    reasoning: "",
    tools: [],
    sources: [],
    feedback: null,
  };
}

/** The visible branch: each turn's active version, followed through `next`. */
function walk(thread: Thread): Array<{ turn: Turn; version: Version }> {
  const out: Array<{ turn: Turn; version: Version }> = [];
  const seen = new Set<string>();
  let id = thread.root;
  while (id && thread.turns[id] && !seen.has(id)) {
    seen.add(id);
    const turn = thread.turns[id];
    const version = turn.versions[turn.active];
    out.push({ turn, version });
    id = version.next;
  }
  return out;
}

function toMessage(reply: Reply): AiChatMessage {
  return {
    id: reply.id,
    role: "assistant",
    content: reply.text.slice(0, reply.shown),
    model: reply.model,
    reasoning: reply.reasoning || undefined,
    thoughtFor: reply.thoughtFor,
    tools: reply.tools,
    sources: reply.sources,
    status: reply.status === "stopped" ? "stopped" : reply.status === "error" ? "error" : "done",
    error: reply.error,
  };
}

function messagesUpTo(thread: Thread, turnId: string): AiChatMessage[] {
  const out: AiChatMessage[] = [];
  for (const { turn, version } of walk(thread)) {
    out.push({ id: version.id, role: "user", content: version.prompt, attachments: version.attachments });
    if (turn.id === turnId) break;
    out.push(toMessage(version.reply));
  }
  return out;
}

function buildThread(messages: AiChatMessage[], model: string, prefix: string): Thread {
  const turns: Record<string, Turn> = {};
  let root: string | null = null;
  let last: Version | null = null;
  let n = 0;

  for (const message of messages) {
    if (message.role === "user") {
      const turnId = `${prefix}-t${n}`;
      const version: Version = {
        id: `${prefix}-v${n}`,
        prompt: message.content,
        attachments: message.attachments,
        reply: newReply(`${prefix}-r${n}`, model),
        next: null,
      };
      turns[turnId] = { id: turnId, versions: [version], active: 0 };
      if (last) last.next = turnId;
      else root = turnId;
      last = version;
      n += 1;
    } else if (last) {
      last.reply = {
        ...last.reply,
        id: message.id ?? last.reply.id,
        model: message.model ?? model,
        status: message.status ?? "done",
        text: message.content,
        shown: message.content.length,
        streamDone: true,
        reasoning: message.reasoning ?? "",
        thoughtFor: message.thoughtFor,
        tools: message.tools ?? [],
        sources: message.sources ?? [],
        error: message.error,
      };
    }
  }

  return { root, turns };
}

function appendTurn(thread: Thread, turn: Turn): Thread {
  const turns = { ...thread.turns, [turn.id]: turn };
  const branch = walk(thread);
  const tail = branch[branch.length - 1];
  if (!tail) return { root: turn.id, turns };
  const parent = turns[tail.turn.id];
  turns[parent.id] = {
    ...parent,
    versions: parent.versions.map((version, index) =>
      index === parent.active ? { ...version, next: turn.id } : version,
    ),
  };
  return { root: thread.root, turns };
}

function updateTurn(thread: Thread, turnId: string, fn: (turn: Turn) => Turn): Thread {
  const turn = thread.turns[turnId];
  return turn ? { ...thread, turns: { ...thread.turns, [turnId]: fn(turn) } } : thread;
}

function updateReply(thread: Thread, turnId: string, versionId: string, fn: (reply: Reply) => Reply): Thread {
  return updateTurn(thread, turnId, (turn) => ({
    ...turn,
    versions: turn.versions.map((version) =>
      version.id === versionId ? { ...version, reply: fn(version.reply) } : version,
    ),
  }));
}

function upsertTool(tools: ChatTool[], tool: ChatTool): ChatTool[] {
  return tools.some((item) => item.id === tool.id)
    ? tools.map((item) => (item.id === tool.id ? { ...item, ...tool } : item))
    : [...tools, tool];
}

function initialChats(props: AiChatProps, model: string, autoPlay: boolean): Chat[] {
  const history = (props.history ?? (props.respond || props.initialMessages ? [] : sampleHistory)).map(
    (item): Chat => ({
      id: item.id,
      title: item.title,
      group: item.group ?? "Earlier",
      thread: buildThread(item.messages, model, item.id),
    }),
  );

  let current: Chat;
  if (props.initialMessages?.length) {
    const first = props.initialMessages.find((message) => message.role === "user")?.content ?? "";
    current = {
      id: "chat-current",
      title: props.title ?? titleFor(first),
      group: "Today",
      thread: buildThread(props.initialMessages, model, "initial"),
    };
  } else if (autoPlay) {
    current = {
      id: DEMO_ID,
      title: props.title ?? titleFor(DEMO_PROMPT),
      group: "Today",
      thread: buildThread([{ role: "user", content: DEMO_PROMPT }], model, "demo"),
    };
  } else {
    current = { id: "chat-new", title: props.title ?? "", group: "Today", thread: EMPTY_THREAD };
  }

  return [current, ...history];
}

/* ---------------------------------------------------------- reveal clock */

const isSpace = (char: string) => char === " " || char === "\n" || char === "\t";

function wordEnd(text: string, from: number) {
  let at = from;
  while (at < text.length && isSpace(text[at])) at += 1;
  while (at < text.length && !isSpace(text[at])) at += 1;
  return at;
}

/**
 * Where the next chunk ends: a few whole words on, never stopping on a half-received word,
 * a bare list marker or an unfinished code fence line.
 */
function nextReveal(text: string, shown: number, words: number, streamDone: boolean) {
  let end = shown;
  for (let i = 0; i < words && end < text.length; i += 1) end = wordEnd(text, end);

  if (end >= text.length && !streamDone) {
    let safe = text.length;
    while (safe > shown && !isSpace(text[safe - 1])) safe -= 1;
    end = safe;
  }
  if (end <= shown) return shown;

  for (let i = 0; i < 4; i += 1) {
    const lineStart = text.lastIndexOf("\n", end - 1) + 1;
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;

    if (FENCE.test(text.slice(lineStart, lineEnd))) {
      if (newline !== -1) return Math.max(end, newline + 1);
      return streamDone ? text.length : Math.max(shown, lineStart);
    }
    if (/^\s*(\d+\.|[-*]|#{1,4})\s*$/.test(text.slice(lineStart, end))) {
      const next = wordEnd(text, end);
      if (next >= text.length && !streamDone) return Math.max(shown, lineStart);
      end = next;
      continue;
    }
    break;
  }
  return end;
}

/* ------------------------------------------------------------ small parts */

const noSubscribe = () => () => {};

function ModelMark({ model, className }: { model: ChatModel; className?: string }) {
  const Mark = model.mark;
  return (
    <Mark
      className={cx(s.mark, className)}
      style={model.color ? { color: model.color } : undefined}
      aria-hidden="true"
      title=""
    />
  );
}

function SourceMark({ source }: { source: ChatSource }) {
  const Mark = source.mark;
  return Mark ? (
    <Mark className={s.mark} style={source.color ? { color: source.color } : undefined} aria-hidden="true" title="" />
  ) : (
    <Globe className={s.mark} size={14} strokeWidth={1.75} aria-hidden="true" />
  );
}

function ModelMenu({
  models,
  value,
  onChange,
  reduced,
}: {
  models: ChatModel[];
  value: ChatModel;
  onChange: (id: string) => void;
  reduced: boolean;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={s.modelChip} aria-label={`Model: ${value.name}`}>
        <Swap swapKey={value.id} reduced={reduced}>
          <ModelMark model={value} />
          <span className={s.modelName}>{value.name}</span>
        </Swap>
        <ChevronDown className={s.chipChevron} size={14} strokeWidth={1.75} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.menu} align="end" sideOffset={6} collisionPadding={12} loop>
          <DropdownMenu.RadioGroup value={value.id} onValueChange={onChange}>
            {models.map((model) => (
              <DropdownMenu.RadioItem key={model.id} value={model.id} className={s.menuItem}>
                <ModelMark model={model} />
                <span className={s.menuName}>{model.name}</span>
                {model.note && <span className={s.menuNote}>{model.note}</span>}
                <span className={s.menuCheck}>
                  <DropdownMenu.ItemIndicator>
                    <Check size={15} strokeWidth={1.75} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Action({
  label,
  onClick,
  children,
  pressed,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        className={cx(s.action, className)}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function CopyAction({
  text,
  label = "Copy",
  reduced,
  onCopied,
}: {
  text: string;
  label?: string;
  reduced: boolean;
  onCopied: (ok: boolean) => void;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let ok = true;
    try {
      await copyText(text);
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "error");
    onCopied(ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <Action label={label} onClick={() => void copy()}>
      <IconSwap swapKey={state} reduced={reduced} className={s.copyIcon}>
        <span data-state={state}>
          {state === "copied" ? (
            <Check size={16} strokeWidth={1.75} />
          ) : state === "error" ? (
            <CircleAlert size={16} strokeWidth={1.75} />
          ) : (
            <Copy size={16} strokeWidth={1.75} />
          )}
        </span>
      </IconSwap>
    </Action>
  );
}

/* -------------------------------------------------------------- reasoning */

function Reasoning({
  model,
  reasoning,
  thinking,
  thoughtFor,
  reduced,
}: {
  model: ChatModel;
  reasoning: string;
  thinking: boolean;
  thoughtFor?: number;
  reduced: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = thinking
    ? "Thinking"
    : thoughtFor
      ? `Thought for ${thoughtFor}s`
      : reasoning
        ? "Thought briefly"
        : model.name;
  const canOpen = !!reasoning;

  return (
    <div className={s.reasoning}>
      <div className={s.replyHead}>
        <Tooltip content={model.name}>
          <span className={s.replyMark}>
            <ModelMark model={model} />
          </span>
        </Tooltip>
        <button
          type="button"
          className={s.thoughtButton}
          aria-expanded={canOpen ? open : undefined}
          aria-controls={open ? id : undefined}
          disabled={!canOpen}
          onClick={() => setOpen(!open)}
        >
          <Swap swapKey={thinking ? "thinking" : label} reduced={reduced}>
            {thinking ? <TextShimmer>Thinking</TextShimmer> : label}
          </Swap>
          <ChevronRight
            className={s.thoughtChevron}
            data-open={open || undefined}
            data-hidden={!canOpen || undefined}
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && reasoning && (
          <motion.div
            key="thoughts"
            id={id}
            className={s.clip}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { height: FOLD_SLOW, opacity: { duration: 0.16, ease: EASE } }}
          >
            <p className={s.thoughtText}>{reasoning}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ tools */

const toolIcons = { search: Search, database: Database, code: CodeIcon, file: FileIcon };

function uniqueByHost(sources: ChatSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const host = hostOf(source.url);
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });
}

function ToolChip({
  tool,
  open,
  onToggle,
  detailId,
  reduced,
}: {
  tool: ChatTool;
  open: boolean;
  onToggle: () => void;
  detailId: string;
  reduced: boolean;
}) {
  const running = tool.status === "running";
  const Icon = toolIcons[tool.icon ?? "search"];
  const Mark = tool.mark;
  const canOpen = !running && !!(tool.input?.length || tool.sources?.length || tool.output);

  return (
    <button
      type="button"
      className={s.toolChip}
      data-status={tool.status}
      aria-expanded={canOpen ? open : undefined}
      aria-controls={open ? detailId : undefined}
      disabled={!canOpen}
      onClick={onToggle}
    >
      <IconSwap swapKey={tool.status} reduced={reduced} className={s.toolIcon}>
        {running ? (
          <LoaderCircle className={s.spin} size={14} strokeWidth={1.75} />
        ) : tool.status === "error" ? (
          <CircleAlert size={14} strokeWidth={1.75} />
        ) : Mark ? (
          <Mark className={s.mark} style={tool.color ? { color: tool.color } : undefined} title="" />
        ) : (
          <Icon size={14} strokeWidth={1.75} />
        )}
      </IconSwap>
      <Swap swapKey={running ? "running" : `${tool.status}-${tool.name}`} reduced={reduced}>
        {running ? (
          <TextShimmer>{tool.activeName ?? tool.name}</TextShimmer>
        ) : (
          <>
            <span className={s.toolName}>{tool.name}</span>
            {tool.sources && tool.sources.length > 0 && (
              <span className={s.toolMarks}>
                {uniqueByHost(tool.sources)
                  .slice(0, 3)
                  .map((source) => (
                    <SourceMark key={source.url} source={source} />
                  ))}
              </span>
            )}
            {tool.summary && <span className={s.toolSummary}>{tool.summary}</span>}
          </>
        )}
      </Swap>
    </button>
  );
}

function ToolDetail({ tool }: { tool: ChatTool }) {
  const isQuery = tool.icon === "database" || tool.icon === "code";
  return (
    <div className={s.toolDetail}>
      {isQuery ? (
        <>
          {tool.input?.map((line) => (
            <pre key={line} className={s.toolCode}>
              {line}
            </pre>
          ))}
          {tool.output && (
            <p className={s.toolOutput}>
              <span>Result</span>
              <span className={s.toolOutputValue}>{tool.output}</span>
            </p>
          )}
        </>
      ) : (
        <>
          {tool.input && tool.input.length > 0 && (
            <ul className={s.queries} aria-label="Searches">
              {tool.input.map((query) => (
                <li key={query}>
                  <Search size={13} strokeWidth={1.75} aria-hidden="true" />
                  {query}
                </li>
              ))}
            </ul>
          )}
          {tool.sources && tool.sources.length > 0 && (
            <ol className={s.sourceList} aria-label="Sources">
              {tool.sources.map((source, index) => (
                <li key={source.url + index}>
                  <a href={source.url} target="_blank" rel="noreferrer" className={s.sourceRow}>
                    <SourceMark source={source} />
                    <span className={s.sourceRowTitle}>{source.title}</span>
                    <span className={s.sourceRowDomain}>{hostOf(source.url)}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function Tools({ tools, reduced }: { tools: ChatTool[]; reduced: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const detailId = useId();
  const openTool = tools.find((tool) => tool.id === openId && tool.status !== "running");

  return (
    <div className={s.tools}>
      <div className={s.toolRow}>
        {tools.map((tool) => (
          <ToolChip
            key={tool.id}
            tool={tool}
            open={openId === tool.id}
            detailId={detailId}
            reduced={reduced}
            onToggle={() => setOpenId(openId === tool.id ? null : tool.id)}
          />
        ))}
      </div>
      <AnimatePresence initial={false}>
        {openTool && (
          <motion.div
            key="detail"
            id={detailId}
            className={s.clip}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { height: FOLD_SLOW, opacity: { duration: 0.16, ease: EASE } }}
          >
            <ToolDetail tool={openTool} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------------------------------------- versions */

function Versions({
  index,
  total,
  onChange,
  disabled,
}: {
  index: number;
  total: number;
  onChange: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <div className={s.versions} role="group" aria-label={`Version ${index + 1} of ${total}`}>
      <button
        type="button"
        className={s.versionButton}
        aria-label="Previous version"
        disabled={disabled || index === 0}
        onClick={() => onChange(index - 1)}
      >
        <ChevronLeft size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span className={s.versionCount} aria-hidden="true">
        {index + 1} / {total}
      </span>
      <button
        type="button"
        className={s.versionButton}
        aria-label="Next version"
        disabled={disabled || index === total - 1}
        onClick={() => onChange(index + 1)}
      >
        <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- composer */

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  placeholder,
  attachments,
  onAttach,
  onRemove,
  inputRef,
  reduced,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  attachments: ChatAttachment[];
  onAttach: (files: File[]) => void;
  onRemove: (id: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  reduced: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(36);

  // A hidden mirror of the text measures the height the field should grow to.
  useLayoutEffect(() => {
    const el = mirror.current;
    if (el) setHeight(Math.min(el.offsetHeight, 180));
  }, [value]);

  useEffect(() => {
    const el = mirror.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(Math.min(el.offsetHeight, 180)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const canSend = !!value.trim() || attachments.length > 0;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) onStop();
    else if (canSend) onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy) submit();
    }
    if (event.key === "Escape" && busy) {
      event.preventDefault();
      onStop();
    }
  }

  return (
    <form className={s.composer} onSubmit={submit}>
      <AnimatePresence initial={false}>
        {attachments.length > 0 && (
          <motion.div
            key="files"
            className={s.clip}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { height: FOLD, opacity: { duration: 0.16, ease: EASE } }}
          >
            <ul className={s.attachRow} aria-label="Attachments">
              {attachments.map((file) => (
                <li key={file.id} className={s.attachChip}>
                  <FileIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span className={s.attachName}>{file.name}</span>
                  <span className={s.attachSize}>{formatSize(file.size)}</span>
                  <button
                    type="button"
                    className={s.attachRemove}
                    aria-label={`Remove ${file.name}`}
                    onClick={() => onRemove(file.id)}
                  >
                    <X size={13} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
      <div className={s.composerRow}>
        <Tooltip content="Attach files">
          <button
            type="button"
            className={s.roundButton}
            aria-label="Attach files"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            if (picked.length) onAttach(picked);
            event.target.value = "";
          }}
        />
        <div className={s.field} style={{ height }}>
          <div ref={mirror} className={s.mirror} aria-hidden="true">
            {value + "\u200b"}
          </div>
          <textarea
            ref={inputRef}
            className={s.input}
            value={value}
            rows={1}
            placeholder={placeholder}
            aria-label="Message"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <button
          type="submit"
          className={s.send}
          data-busy={busy || undefined}
          aria-label={busy ? "Stop reply" : "Send message"}
          disabled={!busy && !canSend}
        >
          <IconSwap swapKey={busy ? "stop" : "send"} reduced={reduced}>
            {busy ? <Square size={13} strokeWidth={0} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2} />}
          </IconSwap>
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ turns */

function UserMessage({
  turnId,
  version,
  busy,
  reduced,
  actions,
}: {
  turnId: string;
  version: Version;
  busy: boolean;
  reduced: boolean;
  actions: TurnActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(version.prompt);
  const row = useRef<HTMLDivElement>(null);
  useGlideHeight(row, editing ? "edit" : version.id, reduced);

  const cancel = () => {
    setEditing(false);
    setDraft(version.prompt);
  };

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const next = draft.trim();
    if (!next) return;
    setEditing(false);
    if (next !== version.prompt.trim()) actions.edit(turnId, next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  return (
    <div ref={row} className={s.userRow}>
      {editing ? (
        <form className={cx(s.editor, s.fadeIn)} onSubmit={submit}>
          <textarea
            className={s.editorInput}
            value={draft}
            aria-label="Edit message"
            autoFocus
            rows={Math.min(8, Math.max(2, draft.split("\n").length + Math.floor(draft.length / 70)))}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={(event) => {
              const end = event.currentTarget.value.length;
              event.currentTarget.setSelectionRange(end, end);
            }}
          />
          <div className={s.editorBar}>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!draft.trim()}>
              Send
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className={cx(s.userActions, s.hoverable)}>
            <CopyAction text={version.prompt} reduced={reduced} onCopied={actions.copied} />
            <Action
              label="Edit"
              disabled={busy}
              onClick={() => {
                setDraft(version.prompt);
                setEditing(true);
              }}
            >
              <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
            </Action>
          </div>
          <div className={s.bubble}>
            {version.attachments && version.attachments.length > 0 && (
              <ul className={s.bubbleFiles} aria-label="Attachments">
                {version.attachments.map((file) => (
                  <li key={file.id}>
                    <FileIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
            {version.prompt && (
              <p className={s.bubbleText}>
                {version.prompt.split(/(`[^`\n]+`)/g).map((part, index) =>
                  part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
                    <code key={index} className={s.inlineCode}>
                      {part.slice(1, -1)}
                    </code>
                  ) : (
                    part
                  ),
                )}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AssistantReply({
  turn,
  version,
  model,
  busy,
  reduced,
  actions,
}: {
  turn: Turn;
  version: Version;
  model: ChatModel;
  busy: boolean;
  reduced: boolean;
  actions: TurnActions;
}) {
  const reply = version.reply;
  const pending = reply.status === "thinking" || reply.status === "streaming";
  const thinking = reply.status === "thinking" && reply.thoughtFor === undefined && !reply.text;
  const settled = reply.status === "done" || reply.status === "stopped";
  const visible = reply.text.slice(0, reply.shown);

  return (
    <div className={s.reply} aria-busy={pending || undefined} data-pending={pending || undefined}>
      <Reasoning
        key={reply.id}
        model={model}
        reasoning={reply.reasoning}
        thinking={thinking}
        thoughtFor={reply.thoughtFor}
        reduced={reduced}
      />
      {reply.tools.length > 0 && <Tools key={`tools-${reply.id}`} tools={reply.tools} reduced={reduced} />}
      {reply.shown > 0 && (
        <Markdown
          source={reply.text}
          shown={reply.shown}
          marks={reply.marks}
          sources={reply.sources}
          reduced={reduced}
        />
      )}
      {reply.status === "stopped" && (
        <p className={cx(s.statusLine, s.fadeIn)}>
          <Square size={11} strokeWidth={0} fill="currentColor" aria-hidden="true" />
          {reply.shown ? "Stopped" : "Stopped before answering"}
        </p>
      )}
      {reply.status === "error" && (
        <div className={cx(s.error, s.fadeIn)}>
          <CircleAlert className={s.errorIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
          <p className={s.errorText}>
            <span className={s.errorTitle}>Reply failed.</span> {reply.error}
          </p>
          <Button variant="secondary" onClick={() => actions.retryInPlace(turn.id, version.id)}>
            Retry
          </Button>
        </div>
      )}
      {reply.status !== "error" && (
        <div className={s.actions} data-hidden={!settled || undefined}>
          {turn.versions.length > 1 && (
            <Versions
              index={turn.active}
              total={turn.versions.length}
              disabled={busy}
              onChange={(index) => actions.select(turn.id, index)}
            />
          )}
          <div className={cx(s.actionGroup, s.hoverable)}>
            <CopyAction
              text={visible
                .replace(/ ?\[\d{1,2}\]/g, "")
                .replace(/\*\*/g, "")
                .replace(/`(?!``)/g, "")
                .trim()}
              reduced={reduced}
              onCopied={actions.copied}
            />
            <Action label="Retry" onClick={() => actions.retry(turn.id)}>
              <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
            </Action>
            <Action
              label="Good response"
              pressed={reply.feedback === "up"}
              onClick={() => actions.feedback(turn.id, version.id, "up")}
            >
              <ThumbsUp
                size={15}
                strokeWidth={1.75}
                fill={reply.feedback === "up" ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </Action>
            <Action
              label="Bad response"
              pressed={reply.feedback === "down"}
              onClick={() => actions.feedback(turn.id, version.id, "down")}
            >
              <ThumbsDown
                size={15}
                strokeWidth={1.75}
                fill={reply.feedback === "down" ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </Action>
          </div>
        </div>
      )}
    </div>
  );
}

/** Memoized so that while a reply streams only its own turn re-renders. */
const TurnView = memo(function TurnView({
  turn,
  version,
  model,
  last,
  busy,
  reduced,
  actions,
}: {
  turn: Turn;
  version: Version;
  model: ChatModel;
  last: boolean;
  busy: boolean;
  reduced: boolean;
  actions: TurnActions;
}) {
  const ref = useRef<HTMLElement>(null);
  useGlideHeight(ref, version.id, reduced);

  return (
    <article ref={ref} className={s.turn} data-last={last || undefined} aria-label="Message">
      <div key={version.id} className={cx(s.turnBody, s.fadeIn)}>
        <UserMessage turnId={turn.id} version={version} busy={busy} reduced={reduced} actions={actions} />
        <AssistantReply turn={turn} version={version} model={model} busy={busy} reduced={reduced} actions={actions} />
      </div>
    </article>
  );
});

/** One conversation's pane. It crossfades on a chat switch and restores that chat's scroll position. */
function Pane({
  id,
  reduced,
  onShow,
  children,
}: {
  id: string;
  reduced: boolean;
  onShow: (id: string) => void;
  children: ReactNode;
}) {
  const show = useRef(onShow);
  useLayoutEffect(() => {
    show.current(id);
  }, [id]);

  return (
    <motion.div
      className={s.pane}
      initial={{ opacity: 0, y: reduced ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1 } }}
      transition={{ duration: reduced ? 0 : 0.16, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

const suggestionIcons = { database: Database, timer: Timer, activity: Activity, search: Search };

/* ---------------------------------------------------------------- AiChat */

export function AiChat(props: AiChatProps) {
  const {
    models = sampleModels,
    respond,
    suggestions = sampleSuggestions,
    greeting = "What are we working on?",
    placeholder = "Ask anything",
    onFeedback,
    onModelChange,
    onNewChat,
    className,
  } = props;

  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const reduced = !!useReducedMotion() && hydrated;
  const autoPlay = props.autoPlay ?? (!respond && !props.initialMessages?.length);
  const simulated = !respond;
  const responder = useMemo(() => respond ?? createSampleResponder(), [respond]);

  const [modelId, setModelId] = useState(() => props.defaultModel ?? models[0]?.id ?? "");
  const model = models.find((item) => item.id === modelId) ?? models[0];
  const modelById = useCallback(
    (id: string) => models.find((item) => item.id === id) ?? sampleModels.find((item) => item.id === id) ?? models[0],
    [models],
  );

  const [chats, setChatsState] = useState<Chat[]>(() =>
    initialChats(props, props.defaultModel ?? models[0]?.id ?? "", autoPlay),
  );
  const [chatId, setChatId] = useState(() => chats[0].id);
  const chatsRef = useRef(chats);
  const chatIdRef = useRef(chatId);

  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<ChatAttachment[]>([]);
  const [stream, setStream] = useState<StreamRef | null>(null);
  const [status, setStatus] = useState({ text: "", n: 0 });
  const [showJump, setShowJump] = useState(false);

  const rootRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<StreamRef | null>(null);
  const stuck = useRef(true);
  const follow = useRef<() => void>(() => {});
  const positions = useRef(new Map<string, { top: number; bottom: boolean }>());
  /** Autoplay stage: 0 first turn, 1 waiting, 2 second turn, -1 off. */
  const stage = useRef(autoPlay ? 0 : -1);
  const autoTimer = useRef(0);
  const reducedRef = useRef(reduced);
  const inView = useInView(rootRef, { once: true, amount: 0.2 });

  const chat = chats.find((item) => item.id === chatId) ?? chats[0];
  const branch = walk(chat.thread);
  const busy = stream?.chatId === chat.id;

  const setChats = useCallback((fn: (chats: Chat[]) => Chat[]) => {
    chatsRef.current = fn(chatsRef.current);
    setChatsState(chatsRef.current);
  }, []);

  const updateChat = useCallback(
    (id: string, fn: (thread: Thread) => Thread) =>
      setChats((list) => list.map((item) => (item.id === id ? { ...item, thread: fn(item.thread) } : item))),
    [setChats],
  );

  const getReply = (ref: { chatId: string; turnId: string; versionId: string }) =>
    chatsRef.current
      .find((item) => item.id === ref.chatId)
      ?.thread.turns[ref.turnId]?.versions.find((version) => version.id === ref.versionId)?.reply;

  const announce = useCallback((text: string) => setStatus((prev) => ({ text, n: prev.n + 1 })), []);
  const sim = simulated ? " (simulated)" : "";

  function cancelAuto() {
    stage.current = -1;
    window.clearTimeout(autoTimer.current);
  }

  function finish(ref: StreamRef, how: "done" | "error" | "stopped", message?: string) {
    if (streamRef.current !== ref) return;
    streamRef.current = null;
    setStream(null);
    announce(how === "done" ? `Reply finished${sim}` : how === "error" ? `Reply failed: ${message}` : "Reply stopped");

    // Chunk spans settle into plain strings shortly after the last one fades in.
    window.setTimeout(
      () =>
        updateChat(ref.chatId, (thread) =>
          updateReply(thread, ref.turnId, ref.versionId, (reply) =>
            reply.marks ? { ...reply, marks: undefined } : reply,
          ),
        ),
      240,
    );

    if (how === "done" && ref.chatId === DEMO_ID) {
      if (stage.current === 0) {
        stage.current = 1;
        autoTimer.current = window.setTimeout(() => {
          if (
            stage.current !== 1 ||
            chatIdRef.current !== DEMO_ID ||
            streamRef.current ||
            inputRef.current?.value
          ) {
            return;
          }
          stage.current = 2;
          api.current.send(DEMO_FOLLOW_UP, [], true);
        }, 1500);
      } else if (stage.current === 2) {
        stage.current = -1;
      }
    }
  }

  async function start(id: string, turnId: string, versionId: string) {
    const ref: StreamRef = {
      controller: new AbortController(),
      chatId: id,
      turnId,
      versionId,
      started: performance.now(),
    };
    const { signal } = ref.controller;
    streamRef.current = ref;
    setStream(ref);

    const replyModel = modelById(getReply(ref)?.model ?? modelId);
    announce(`${replyModel.name} is replying${sim}`);

    const patch = (fn: (reply: Reply) => Reply) =>
      updateChat(id, (thread) => updateReply(thread, turnId, versionId, fn));
    const elapsed = () => Math.max(1, Math.round((performance.now() - ref.started) / 1000));

    try {
      const thread = chatsRef.current.find((item) => item.id === id)?.thread ?? EMPTY_THREAD;
      for await (const event of responder(messagesUpTo(thread, turnId), { signal, model: replyModel })) {
        if (signal.aborted) return;
        if (event.type === "reasoning") {
          patch((reply) => ({ ...reply, reasoning: reply.reasoning + event.delta }));
        } else if (event.type === "reasoning-end") {
          patch((reply) => ({ ...reply, thoughtFor: event.seconds ?? elapsed() }));
        } else if (event.type === "tool") {
          patch((reply) => ({ ...reply, tools: upsertTool(reply.tools, event.tool) }));
        } else if (event.type === "sources") {
          patch((reply) => ({ ...reply, sources: event.sources }));
        } else if (event.type === "text") {
          patch((reply) => ({
            ...reply,
            text: reply.text + event.delta,
            status: "streaming",
            thoughtFor: reply.thoughtFor ?? (reply.reasoning ? elapsed() : undefined),
          }));
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
      if (signal.aborted) return;
      patch((reply) => ({
        ...reply,
        streamDone: true,
        status: reply.text ? "streaming" : "done",
        thoughtFor: reply.thoughtFor ?? (reply.reasoning ? elapsed() : undefined),
      }));
      if (!getReply(ref)?.text) finish(ref, "done");
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      patch((reply) => ({
        ...reply,
        status: "error",
        error: message,
        text: reply.text.slice(0, reply.shown),
        marks: undefined,
        streamDone: true,
        tools: reply.tools.map((tool) => (tool.status === "running" ? { ...tool, status: "error" } : tool)),
      }));
      finish(ref, "error", message);
    }
  }

  function stop() {
    const ref = streamRef.current;
    if (!ref) return;
    ref.controller.abort();
    const seconds = Math.max(1, Math.round((performance.now() - ref.started) / 1000));
    updateChat(ref.chatId, (thread) =>
      updateReply(thread, ref.turnId, ref.versionId, (reply) => ({
        ...reply,
        status: "stopped",
        text: reply.text.slice(0, reply.shown),
        streamDone: true,
        thoughtFor: reply.thoughtFor ?? (reply.reasoning ? seconds : undefined),
        tools: reply.tools.map((tool) =>
          tool.status === "running"
            ? { ...tool, status: "error", name: tool.activeName ?? tool.name, summary: "Stopped" }
            : tool,
        ),
      })),
    );
    finish(ref, "stopped");
  }

  function stick() {
    stuck.current = true;
    setShowJump(false);
    follow.current();
  }

  function send(text: string, attached: ChatAttachment[] = files, auto = false) {
    const prompt = text.trim();
    if (!prompt && !attached.length) return;
    if (!auto) cancelAuto();
    if (streamRef.current) stop();

    const id = chatIdRef.current;
    const turnId = uid("turn");
    const versionId = uid("version");

    updateChat(id, (thread) =>
      appendTurn(thread, {
        id: turnId,
        versions: [
          {
            id: versionId,
            prompt,
            attachments: attached.length ? attached : undefined,
            reply: newReply(uid("reply"), modelId),
            next: null,
          },
        ],
        active: 0,
      }),
    );
    setChats((list) =>
      list.map((item) =>
        item.id !== id || item.title ? item : { ...item, title: titleFor(prompt || attached[0].name) },
      ),
    );
    if (!auto) {
      setDraft("");
      setFiles([]);
    }
    stick();
    void start(id, turnId, versionId);
  }

  /** A retry or an edit adds a version to the turn; later turns belong to the version they followed. */
  function addVersion(turnId: string, prompt?: string) {
    cancelAuto();
    if (streamRef.current) stop();
    const id = chatIdRef.current;
    const turn = chatsRef.current.find((item) => item.id === id)?.thread.turns[turnId];
    if (!turn) return;
    const current = turn.versions[turn.active];
    const versionId = uid("version");

    updateChat(id, (thread) =>
      updateTurn(thread, turnId, (item) => ({
        ...item,
        active: item.versions.length,
        versions: [
          ...item.versions,
          {
            id: versionId,
            prompt: prompt ?? current.prompt,
            attachments: current.attachments,
            reply: newReply(uid("reply"), modelId),
            next: null,
          },
        ],
      })),
    );
    stick();
    void start(id, turnId, versionId);
  }

  const actions: TurnActions = {
    retry: (turnId) => addVersion(turnId),
    edit: (turnId, prompt) => addVersion(turnId, prompt),
    retryInPlace: (turnId, versionId) => {
      cancelAuto();
      if (streamRef.current) stop();
      const id = chatIdRef.current;
      updateChat(id, (thread) => updateReply(thread, turnId, versionId, () => newReply(uid("reply"), modelId)));
      stick();
      void start(id, turnId, versionId);
    },
    select: (turnId, index) => {
      updateChat(chatIdRef.current, (thread) =>
        updateTurn(thread, turnId, (turn) => ({
          ...turn,
          active: Math.max(0, Math.min(turn.versions.length - 1, index)),
        })),
      );
      const turn = chatsRef.current.find((item) => item.id === chatIdRef.current)?.thread.turns[turnId];
      if (turn) announce(`Version ${turn.active + 1} of ${turn.versions.length}`);
    },
    feedback: (turnId, versionId, value) => {
      const reply = getReply({ chatId: chatIdRef.current, turnId, versionId });
      if (!reply) return;
      const next: Feedback = reply.feedback === value ? null : value;
      updateChat(chatIdRef.current, (thread) =>
        updateReply(thread, turnId, versionId, (item) => ({ ...item, feedback: next })),
      );
      if (onFeedback) onFeedback(toMessage(reply), next);
      announce(
        next
          ? `Feedback sent: ${next === "up" ? "good" : "bad"} response${onFeedback ? "" : " (simulated)"}`
          : "Feedback removed",
      );
    },
    copied: (ok) => announce(ok ? "Copied to clipboard" : "Could not copy"),
  };

  // Turns get one stable set of callbacks that always reach the latest closures.
  const api = useRef({ send, start, actions });
  useLayoutEffect(() => {
    api.current = { send, start, actions };
  });
  const stableActions = useMemo<TurnActions>(
    () => ({
      retry: (...args) => api.current.actions.retry(...args),
      edit: (...args) => api.current.actions.edit(...args),
      retryInPlace: (...args) => api.current.actions.retryInPlace(...args),
      select: (...args) => api.current.actions.select(...args),
      feedback: (...args) => api.current.actions.feedback(...args),
      copied: (...args) => api.current.actions.copied(...args),
    }),
    [],
  );

  function savePosition() {
    const el = scrollerRef.current;
    if (el) positions.current.set(chatIdRef.current, { top: el.scrollTop, bottom: stuck.current });
  }

  function openChat(id: string) {
    if (id === chatIdRef.current) return;
    cancelAuto();
    savePosition();
    chatIdRef.current = id;
    setChatId(id);
    const next = chatsRef.current.find((item) => item.id === id);
    announce(`Opened ${next?.title || "untitled chat"}`);
  }

  function newChat() {
    cancelAuto();
    const blank = chatsRef.current.find((item) => !item.thread.root && !item.title);
    if (blank) {
      openChat(blank.id);
    } else {
      const id = uid("chat");
      savePosition();
      setChats((list) => [{ id, title: "", group: "Today", thread: EMPTY_THREAD }, ...list]);
      chatIdRef.current = id;
      setChatId(id);
      announce("New chat");
    }
    onNewChat?.();
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function showPane(id: string) {
    const el = scrollerRef.current;
    if (!el) return;
    const saved = positions.current.get(id);
    if (!saved || saved.bottom) {
      el.scrollTop = el.scrollHeight;
      stuck.current = true;
      setShowJump(false);
    } else {
      el.scrollTop = saved.top;
      stuck.current = false;
      setShowJump(el.scrollHeight - el.clientHeight - saved.top > 8);
    }
  }

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // The reveal clock: every 34ms, show the next three or four whole words of what has arrived.
  useEffect(() => {
    if (!stream) return;
    let frame = 0;
    let last = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 34) return;
      last = now;

      const reply = getReply(stream);
      if (!reply || reply.status !== "streaming") return;

      if (reply.shown >= reply.text.length) {
        if (reply.streamDone) {
          updateChat(stream.chatId, (thread) =>
            updateReply(thread, stream.turnId, stream.versionId, (item) => ({ ...item, status: "done" })),
          );
          finish(stream, "done");
        }
        return;
      }

      const next = nextReveal(
        reply.text,
        reply.shown,
        reply.text.length - reply.shown > 600 ? 4 : 3,
        reply.streamDone,
      );
      if (next > reply.shown) {
        updateChat(stream.chatId, (thread) =>
          updateReply(thread, stream.turnId, stream.versionId, (item) => ({
            ...item,
            shown: next,
            marks: [...(item.marks ?? []), item.shown],
          })),
        );
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // While stuck to the bottom, follow new lines on a soft lerp. Scrolling up releases it.
  useEffect(() => {
    const el = scrollerRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    let touchY = 0;

    const step = () => {
      frame = 0;
      if (!stuck.current) return;
      const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (gap <= 0.5) return;
      el.scrollTop += reducedRef.current ? gap : Math.max(1, 0.22 * gap);
      frame = requestAnimationFrame(step);
    };
    follow.current = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };

    const observer = new ResizeObserver(() => follow.current());
    observer.observe(content);
    observer.observe(el);

    const release = () => {
      stuck.current = false;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) release();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if ((event.touches[0]?.clientY ?? 0) > touchY + 4) release();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) release();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === el) release();
    };
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 8;
      if (atBottom) stuck.current = true;
      setShowJump(!atBottom && !stuck.current);
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // A trailing user message is answered when the chat first scrolls into view.
  useEffect(() => {
    if (!inView || streamRef.current) return;
    const current = chatsRef.current.find((item) => item.id === chatIdRef.current);
    const turns = current ? walk(current.thread) : [];
    const tail = turns[turns.length - 1];
    if (!current || !tail || tail.version.reply.status !== "thinking") return;

    const timer = window.setTimeout(
      () => {
        if (!streamRef.current) void api.current.start(current.id, tail.turn.id, tail.version.id);
      },
      stage.current === 0 ? 450 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [inView]);

  // Stop the stream and any pending autoplay when the chat unmounts.
  useEffect(
    () => () => {
      window.clearTimeout(autoTimer.current);
      streamRef.current?.controller.abort();
      streamRef.current = null;
    },
    [],
  );

  const groups = useMemo(() => {
    const names: string[] = [];
    const byGroup = new Map<string, Chat[]>();
    for (const item of chats) {
      if (!byGroup.has(item.group)) {
        byGroup.set(item.group, []);
        names.push(item.group);
      }
      byGroup.get(item.group)!.push(item);
    }
    return names.map((name) => ({ name, chats: byGroup.get(name)! }));
  }, [chats]);

  const title = chat.title || "New chat";

  return (
    <section ref={rootRef} className={cx(s.root, className)} aria-label="AI chat">
      <header className={s.header}>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger className={s.titleButton} aria-label={`Chats, current: ${title}`}>
            <Swap swapKey={`${chat.id}:${title}`} reduced={reduced} className={s.titleSwap}>
              <span className={s.titleText}>{title}</span>
            </Swap>
            <ChevronDown className={s.chipChevron} size={14} strokeWidth={1.75} aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={cx(s.menu, s.chatMenu)}
              align="start"
              sideOffset={6}
              collisionPadding={12}
              loop
            >
              <DropdownMenu.Item className={s.menuItem} onSelect={newChat}>
                <SquarePen size={15} strokeWidth={1.75} aria-hidden="true" />
                <span className={s.menuName}>New chat</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={s.menuSeparator} />
              {groups.map((group) => (
                <DropdownMenu.RadioGroup key={group.name} value={chat.id} onValueChange={openChat}>
                  <DropdownMenu.Label className={s.menuLabel}>{group.name}</DropdownMenu.Label>
                  {group.chats.map((item) => (
                    <DropdownMenu.RadioItem key={item.id} value={item.id} className={s.menuItem}>
                      <span className={s.menuName}>{item.title || "Untitled chat"}</span>
                      <span className={s.menuCheck}>
                        <DropdownMenu.ItemIndicator>
                          <Check size={15} strokeWidth={1.75} aria-hidden="true" />
                        </DropdownMenu.ItemIndicator>
                      </span>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <span className={s.spacer} />

        {model && (
          <ModelMenu
            models={models}
            value={model}
            reduced={reduced}
            onChange={(id) => {
              const next = models.find((item) => item.id === id);
              if (!next || next.id === modelId) return;
              setModelId(next.id);
              onModelChange?.(next);
              announce(`${next.name} selected. New replies use it.`);
            }}
          />
        )}

        <Tooltip content="New chat" side="bottom">
          <button type="button" className={s.iconButton} aria-label="New chat" onClick={newChat}>
            <SquarePen size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
      </header>

      <div className={s.body}>
        <div ref={scrollerRef} className={s.scroller}>
          <div ref={contentRef} className={s.content}>
            <AnimatePresence mode="wait" initial={false}>
              <Pane key={chat.id} id={chat.id} reduced={reduced} onShow={showPane}>
                {branch.length ? (
                  <div className={s.thread}>
                    {branch.map(({ turn, version }, index) => (
                      <TurnView
                        key={turn.id}
                        turn={turn}
                        version={version}
                        model={modelById(version.reply.model)}
                        last={index === branch.length - 1}
                        busy={busy}
                        reduced={reduced}
                        actions={stableActions}
                      />
                    ))}
                  </div>
                ) : (
                  <div className={s.empty}>
                    <h2 className={s.greeting}>{greeting}</h2>
                    <ul className={s.suggestions}>
                      {suggestions.slice(0, 3).map((suggestion) => {
                        const Icon = suggestionIcons[suggestion.icon ?? "search"];
                        return (
                          <li key={suggestion.label}>
                            <button
                              type="button"
                              className={s.suggestion}
                              onClick={() => send(suggestion.prompt ?? suggestion.label, [])}
                            >
                              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                              {suggestion.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Pane>
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {showJump && (
            <motion.button
              key="jump"
              type="button"
              className={s.jump}
              aria-label="Scroll to latest message"
              initial={{ opacity: 0, y: reduced ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : 4, transition: { duration: 0.1 } }}
              transition={{ duration: 0.16, ease: EASE }}
              onClick={() => {
                stuck.current = true;
                setShowJump(false);
                scrollerRef.current?.scrollTo({
                  top: scrollerRef.current.scrollHeight,
                  behavior: reduced ? "auto" : "smooth",
                });
              }}
            >
              <ArrowDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className={s.composerDock}>
        <Composer
          value={draft}
          busy={busy}
          placeholder={placeholder}
          attachments={files}
          inputRef={inputRef}
          reduced={reduced}
          onChange={(value) => {
            cancelAuto();
            setDraft(value);
          }}
          onSubmit={() => send(draft)}
          onStop={stop}
          onAttach={(picked) => {
            cancelAuto();
            setFiles((list) =>
              [
                ...list,
                ...picked.map((file) => ({ id: uid("file"), name: file.name, size: file.size, type: file.type })),
              ].slice(0, 4),
            );
            announce(`${picked.length === 1 ? picked[0].name : `${picked.length} files`} attached`);
          }}
          onRemove={(id) => setFiles((list) => list.filter((file) => file.id !== id))}
        />
      </div>

      <p className={s.srOnly} role="status" aria-live="polite">
        {status.text}
        {status.n % 2 ? "\u00a0" : ""}
      </p>
    </section>
  );
}

export default AiChat;
