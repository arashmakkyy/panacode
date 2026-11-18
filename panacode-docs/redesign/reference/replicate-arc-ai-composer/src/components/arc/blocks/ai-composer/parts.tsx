import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  AtSign,
  Brain,
  Camera,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardPaste,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Globe,
  Paperclip,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "../../tooltip";
import { cx, tokens } from "../../tokens";
import { ClaudeMark, FigmaMark, GeminiMark, GitHubMark, GoogleDriveMark, LinearMark, NotionMark, OpenAIMark } from "./marks";
import {
  effortHints,
  effortLabels,
  efforts,
  type Attachment,
  type AttachmentKind,
  type ComposerContext,
  type ComposerModel,
  type Effort,
} from "./data";

const { spring, duration, ease } = tokens;
export const quick = { type: "spring" as const, visualDuration: 0.24, bounce: 0 };

/* ---------- Tokens in text ---------- */

export type TokenRange = { start: number; end: number; text: string };

/** Finds every known token in the text, longest first, on word boundaries. */
export function tokenRanges(text: string, tokenList: string[]): TokenRange[] {
  const ranges: TokenRange[] = [];
  for (const token of [...new Set(tokenList)].sort((a, b) => b.length - a.length)) {
    let from = 0;
    for (;;) {
      const start = text.indexOf(token, from);
      if (start < 0) break;
      const end = start + token.length;
      const opens = start === 0 || /\s/.test(text[start - 1] ?? "");
      const closes = end === text.length || /[\s.,;:!?)]/.test(text[end] ?? "");
      if (opens && closes && !ranges.some((range) => start < range.end && end > range.start)) ranges.push({ start, end, text: token });
      from = end;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

export type Trigger = { type: "@" | "/"; start: number; query: string };

/** The / or @ being typed at the caret, if any. */
export function findTrigger(text: string, caret: number, ranges: TokenRange[]): Trigger | null {
  if (ranges.some((range) => caret > range.start && caret <= range.end)) return null;
  let index = caret - 1;
  while (index >= 0 && !/\s/.test(text[index] ?? "") && text[index] !== "@" && text[index] !== "/") index -= 1;
  const char = text[index];
  if (index < 0 || (char !== "@" && char !== "/")) return null;
  const before = index === 0 ? "" : (text[index - 1] ?? "");
  if ((before && !/\s/.test(before)) || (char === "/" && before && before !== "\n")) return null;
  const query = text.slice(index + 1, caret);
  return query.length > 24 ? null : { type: char, start: index, query };
}

/* ---------- Glyphs ---------- */

const kindIcons: Record<AttachmentKind, LucideIcon> = {
  pdf: FileText,
  code: FileCode,
  sheet: FileSpreadsheet,
  doc: FileText,
  image: FileImage,
  archive: FileArchive,
  text: FileText,
};

export function FileGlyph({ item, size = "md" }: { item: Attachment; size?: "sm" | "md" }) {
  if (item.thumb) return <img className={size === "sm" ? "aic-thumbSmall" : "aic-thumb"} src={item.thumb} alt="" draggable={false} />;
  if (item.source === "drive") return <GoogleDriveMark className="aic-glyph" aria-hidden="true" />;
  if (item.source === "github") return <GitHubMark className="aic-glyph" aria-hidden="true" />;
  if (item.source === "paste") return <ClipboardPaste className="aic-glyph" aria-hidden="true" />;
  const Icon = kindIcons[item.kind];
  return <Icon className="aic-glyph" aria-hidden="true" />;
}

export function ModelMark({ mark, className }: { mark: ComposerModel["mark"]; className?: string }) {
  if (mark === "claude") return <ClaudeMark className={cx("aic-modelMark", "aic-claudeMark", className)} aria-hidden="true" />;
  if (mark === "openai") return <OpenAIMark className={cx("aic-modelMark", className)} aria-hidden="true" />;
  return <GeminiMark className={cx("aic-modelMark", className)} aria-hidden="true" />;
}

export function ContextGlyph({ kind }: { kind: ComposerContext["kind"] }) {
  if (kind === "notion") return <NotionMark className="aic-optionGlyph" aria-hidden="true" />;
  if (kind === "linear") return <LinearMark className="aic-optionGlyph" aria-hidden="true" />;
  if (kind === "figma") return <FigmaMark className="aic-optionGlyph" aria-hidden="true" />;
  const Icon = kind === "code" ? FileCode : kind === "sheet" ? FileSpreadsheet : FileText;
  return <Icon className="aic-optionGlyph" aria-hidden="true" />;
}

/* ---------- Attachment chip ---------- */

function ProgressRing({ progress }: { progress: number }) {
  return (
    <svg className="aic-ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle className="aic-ringTrack" cx="9" cy="9" r="7" />
      <circle className="aic-ringFill" cx="9" cy="9" r="7" pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: 1 - progress }} />
    </svg>
  );
}

export function AttachmentChip({ item, reduced, onRemove }: { item: Attachment; reduced: boolean; onRemove: (id: string) => void }) {
  const percent = Math.round(item.progress * 100);
  const actionLabel = item.status === "uploading" ? `Cancel upload of ${item.name}` : `Remove ${item.name}`;
  const pop = reduced ? { duration: 0 } : quick;

  return (
    <motion.li
      layout={reduced ? false : "position"}
      className="aic-chip"
      data-status={item.status}
      title={item.name}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={
        reduced
          ? { opacity: 0, transition: { duration: 0 } }
          : { opacity: 0, scale: 0.92, transition: { duration: duration.fast, ease: ease.standard } }
      }
      transition={reduced ? { duration: duration.fast } : quick}
    >
      <span className={cx("aic-chipGlyph", item.thumb && "aic-chipGlyphImage")}>
        <FileGlyph item={item} />
      </span>
      <span className="aic-chipText">
        <span className="aic-chipName">{item.name}</span>
        <span className="aic-chipMeta" aria-live="off">
          {item.status === "error" ? (
            <>
              <CircleAlert className="aic-chipMetaIcon" aria-hidden="true" />
              {item.error}
            </>
          ) : item.status === "uploading" ? (
            <span className="aic-tabular">Uploading {percent}%</span>
          ) : (
            item.meta
          )}
        </span>
      </span>
      <button
        type="button"
        className="aic-chipAction"
        aria-label={actionLabel}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(item.id);
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {item.status === "uploading" ? (
            <motion.span key="ring" className="aic-chipActionGlyph" exit={{ opacity: 0, scale: 0.6, transition: { duration: duration.instant } }}>
              <ProgressRing progress={item.progress} />
            </motion.span>
          ) : item.status === "done" ? (
            <motion.span
              key="check"
              className="aic-chipActionGlyph aic-chipCheck"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: duration.fast } }}
              transition={pop}
            >
              <Check aria-hidden="true" />
            </motion.span>
          ) : (
            <motion.span
              key="remove"
              className="aic-chipActionGlyph"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -45 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={pop}
            >
              <X aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </motion.li>
  );
}

/* ---------- Width morph for the model chip label ---------- */

function MorphWidth({ children, reduced, className }: { children: ReactNode; reduced: boolean; className?: string }) {
  const innerRef = useRef<HTMLSpanElement>(null);
  const measured = useRef(false);
  const [box, setBox] = useState<{ width: number | "auto"; animate: boolean }>({ width: "auto", animate: false });

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const animate = measured.current;
      measured.current = true;
      setBox({ width: Math.ceil(entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth), animate });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.span
      className={cx("aic-morph", className)}
      initial={false}
      animate={{ width: box.width }}
      transition={box.animate && !reduced ? quick : { duration: 0 }}
    >
      <span ref={innerRef} className="aic-morphInner">
        {children}
      </span>
    </motion.span>
  );
}

/* ---------- Send and stop ---------- */

export type SendState = "empty" | "blocked" | "ready" | "generating";

export function SendButton({
  state,
  progress,
  progressSeconds,
  run,
  label,
  reduced,
  onSend,
  onStop,
}: {
  state: SendState;
  /** 0 to 1 while the reply is known, null while a live stream has no length yet. */
  progress: number | null;
  progressSeconds: number;
  run: number;
  label: string;
  reduced: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const generating = state === "generating";
  const usable = state === "ready" || generating;
  const known = progress !== null;
  const offset = known ? 1 - Math.max(0.02, progress) : 0.72;

  return (
    <Tooltip content={label}>
      <motion.button
        type="button"
        className="aic-send"
        data-state={state}
        aria-label={label}
        aria-disabled={!usable || undefined}
        onClick={() => {
          if (generating) onStop();
          else if (state === "ready") onSend();
        }}
        whileTap={usable && !reduced ? { scale: 0.92 } : undefined}
        transition={spring.snappy}
      >
        <svg className="aic-sendRing" data-spin={(generating && !known && !reduced) || undefined} viewBox="0 0 44 44" aria-hidden="true">
          <motion.circle
            className="aic-sendTrack"
            cx="22"
            cy="22"
            r="20.5"
            initial={false}
            animate={{ opacity: generating ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : duration.standard }}
          />
          <motion.circle
            key={run}
            className="aic-sendArc"
            cx="22"
            cy="22"
            r="20.5"
            pathLength={1}
            strokeDasharray="1 1"
            initial={{ strokeDashoffset: 1, opacity: 0 }}
            animate={{ strokeDashoffset: offset, opacity: generating ? 1 : 0 }}
            transition={{
              strokeDashoffset: reduced ? { duration: 0 } : { duration: Math.max(0.12, progressSeconds), ease: "linear" },
              opacity: { duration: reduced ? 0 : duration.standard, delay: generating || reduced ? 0 : 0.12 },
            }}
          />
        </svg>
        <AnimatePresence mode="popLayout" initial={false}>
          {generating ? (
            <motion.span
              key="stop"
              className="aic-sendGlyph"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3, borderRadius: 8 }}
              animate={{ opacity: 1, scale: 1, borderRadius: 3 }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : { opacity: 0, scale: 0.3, transition: { duration: duration.fast, ease: ease.standard } }
              }
              transition={reduced ? { duration: 0 } : quick}
            >
              <span className="aic-stopGlyph" />
            </motion.span>
          ) : (
            <motion.span
              key="arrow"
              className="aic-sendGlyph"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -14, transition: { duration: duration.fast, ease: ease.exit } }
              }
              transition={reduced ? { duration: 0 } : quick}
            >
              <ArrowUp aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </Tooltip>
  );
}

/* ---------- Toolbar chips ---------- */

export function ToolChip({ tool, on, onToggle }: { tool: "search" | "thinking"; on: boolean; onToggle: () => void }) {
  const Icon = tool === "search" ? Globe : Brain;
  const label = tool === "search" ? "Web search" : "Extended thinking";
  const tip =
    tool === "search"
      ? on
        ? "Web search is on"
        : "Search the web while answering"
      : on
        ? "Extended thinking is on"
        : "Think longer before answering";

  return (
    <Tooltip content={tip}>
      <button type="button" className="aic-toolChip" aria-pressed={on} aria-label={label} onClick={onToggle}>
        <Icon className="aic-toolIcon" aria-hidden="true" />
        <span className="aic-toolLabel">{label}</span>
      </button>
    </Tooltip>
  );
}

/* ---------- Plus menu ---------- */

export function AttachMenu({
  onUpload,
  onDrive,
  onGithub,
  onScreenshot,
  onMention,
  onClosedAfterPick,
}: {
  onUpload: () => void;
  onDrive: () => void;
  onGithub: () => void;
  onScreenshot: () => void;
  onMention: () => void;
  onClosedAfterPick: () => void;
}) {
  const picked = useRef(false);
  const item = (key: string, icon: ReactNode, label: string, action: () => void) => (
    <Menu.Item
      key={key}
      className="aic-menuItem"
      onSelect={() => {
        picked.current = true;
        action();
      }}
    >
      <span className="aic-menuIcon" aria-hidden="true">
        {icon}
      </span>
      {label}
    </Menu.Item>
  );

  return (
    <Menu.Root modal={false}>
      <Tooltip content="Add files and context">
        <Menu.Trigger asChild>
          <button type="button" className="aic-iconButton" aria-label="Add files and context">
            <Plus aria-hidden="true" />
          </button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Content
          className="aic-menu"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          loop
          onCloseAutoFocus={(event) => {
            if (picked.current) {
              event.preventDefault();
              picked.current = false;
              onClosedAfterPick();
            }
          }}
        >
          {item("upload", <Paperclip />, "Upload file", onUpload)}
          {item("drive", <GoogleDriveMark />, "Add from Google Drive", onDrive)}
          {item("github", <GitHubMark />, "Add from GitHub", onGithub)}
          {item("shot", <Camera />, "Take a screenshot", onScreenshot)}
          <Menu.Separator className="aic-menuSeparator" />
          {item("mention", <AtSign />, "Mention a file or doc", onMention)}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* ---------- Model and effort menu ---------- */

export function ModelMenu({
  models,
  model,
  effort,
  reduced,
  onModel,
  onEffort,
}: {
  models: ComposerModel[];
  model: ComposerModel;
  effort: Effort;
  reduced: boolean;
  onModel: (id: string) => void;
  onEffort: (effort: Effort) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const byPointer = useRef(false);

  function moveAlongEffort(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitemradio']"));
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    items[(index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="aic-modelChip"
          onPointerDown={() => {
            byPointer.current = true;
          }}
          onKeyDown={() => {
            byPointer.current = false;
          }}
          aria-label={`Model: ${model.name}, ${effortLabels[effort].toLowerCase()} effort`}
        >
          <ModelMark mark={model.mark} />
          <MorphWidth reduced={reduced} className="aic-modelText">
            <span className="aic-modelName">{model.short}</span>
            <span className="aic-modelEffort">{effortLabels[effort]}</span>
          </MorphWidth>
          <ChevronDown className="aic-chevron" aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="aic-menu aic-modelMenu"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          loop
          onCloseAutoFocus={(event) => {
            /* Pointer use returns focus without drawing the keyboard ring. */
            if (byPointer.current) {
              event.preventDefault();
              triggerRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
            }
          }}
          onPointerDownCapture={() => {
            byPointer.current = true;
          }}
          onKeyDownCapture={() => {
            byPointer.current = false;
          }}
        >
          <Menu.RadioGroup value={model.id} onValueChange={onModel}>
            {models.map((option) => (
              <Menu.RadioItem key={option.id} value={option.id} className="aic-menuItem aic-modelItem">
                <ModelMark mark={option.mark} />
                <span className="aic-modelItemText">
                  <span className="aic-modelItemName">{option.name}</span>
                  <span className="aic-modelItemNote">{option.note}</span>
                </span>
                <Menu.ItemIndicator className="aic-modelCheck">
                  <Check aria-hidden="true" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="aic-menuSeparator" />
          <Menu.Label className="aic-effortHead">
            <span>Effort</span>
            <span className="aic-effortHint">{effortHints[effort]}</span>
          </Menu.Label>
          <Menu.RadioGroup value={effort} onValueChange={(value) => onEffort(value as Effort)} className="aic-effortRow" onKeyDown={moveAlongEffort}>
            {efforts.map((level) => (
              <Menu.RadioItem key={level} value={level} className="aic-effortItem" onSelect={(event) => event.preventDefault()}>
                {level === effort && (
                  <motion.span layoutId="ai-composer-effort" className="aic-effortThumb" transition={reduced ? { duration: 0 } : quick} />
                )}
                <span className="aic-effortText">{effortLabels[level]}</span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* ---------- Character counter ---------- */

export function Counter({ length, max }: { length: number; max: number }) {
  const ratio = length / max;
  const over = length > max;
  const left = max - length;
  const full = over
    ? `${(-left).toLocaleString("en-US")} characters over the limit`
    : `${left.toLocaleString("en-US")} of ${max.toLocaleString("en-US")} characters left`;

  return (
    <Tooltip content={full}>
      <span className="aic-counter" data-tone={over ? "over" : ratio >= 0.95 ? "near" : "calm"}>
        {over ? (
          <CircleAlert className="aic-counterIcon" aria-hidden="true" />
        ) : (
          <svg className="aic-counterRing" viewBox="0 0 20 20" aria-hidden="true">
            <circle className="aic-ringTrack" cx="10" cy="10" r="8" />
            <circle
              className="aic-counterFill"
              cx="10"
              cy="10"
              r="8"
              pathLength={1}
              strokeDasharray="1 1"
              style={{ strokeDashoffset: 1 - Math.min(1, ratio) }}
            />
          </svg>
        )}
        <span className="aic-counterText">{over ? `${(-left).toLocaleString("en-US")} over` : `${left.toLocaleString("en-US")} left`}</span>
        <span className="aic-srOnly">{full}</span>
      </span>
    </Tooltip>
  );
}

/* ---------- Dictation ---------- */

const BARS = 56;

function level(elapsed: number, speechMs: number) {
  if (elapsed > speechMs) return 0.05 + 0.04 * Math.random();
  const t = elapsed / 1000;
  return Math.min(
    1,
    0.1 +
      (0.6 * Math.abs(Math.sin(11.3 * t)) + 0.4 * Math.abs(Math.sin(4.7 * t + 1.3))) *
        (Math.sin(2.4 * t) > -0.55 ? 1 : 0.15) *
        (0.65 + 0.45 * Math.random()),
  );
}

/** The waveform writes bar transforms directly on animation frames, without re-rendering React. */
export function Wave({ startedAt, speechMs, reduced }: { startedAt: number; speechMs: number; reduced: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const bars = Array.from(ref.current?.children ?? []) as HTMLElement[];
    const levels: number[] = Array(BARS).fill(0.06);
    if (reduced) {
      bars.forEach((bar, index) => {
        bar.style.transform = `scaleY(${0.18 + 0.3 * Math.abs(Math.sin(0.7 * index))})`;
      });
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 70) {
        last = now;
        levels.shift();
        levels.push(level(Date.now() - startedAt, speechMs));
        bars.forEach((bar, index) => {
          bar.style.transform = `scaleY(${Math.max(0.06, levels[index] ?? 0)})`;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt, speechMs, reduced]);

  return (
    <span ref={ref} className="aic-wave" aria-hidden="true">
      {Array.from({ length: BARS }, (_, index) => (
        <span key={index} className="aic-bar" />
      ))}
    </span>
  );
}

export function Timer({ from }: { from: number }) {
  const [now, setNow] = useState(from);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.floor((now - from) / 1000));
  return (
    <span className="aic-timer aic-tabular">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}
