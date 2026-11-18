import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, FileText, Languages, Lightbulb, Mic, Wrench, X, type LucideIcon } from "lucide-react";
import { Tooltip } from "../../tooltip";
import { TextShimmer } from "../../text-shimmer";
import { cx, tokens } from "../../tokens";
import {
  AttachMenu,
  AttachmentChip,
  ContextGlyph,
  Counter,
  ModelMenu,
  SendButton,
  Timer,
  ToolChip,
  Wave,
  findTrigger,
  quick,
  tokenRanges,
  type SendState,
  type TokenRange,
} from "./parts";
import {
  dictationTranscript,
  knownTokens,
  sampleCommands,
  sampleContexts,
  screenshotThumb,
  type Attachment,
  type AttachmentKind,
  type ComposerCommand,
  type ComposerContext,
  type ComposerModel,
  type Effort,
} from "./data";

const { spring, duration, ease } = tokens;

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 208;
const SPEECH_MS = 4200;
const SIZE_LIMIT = 30 * 1024 * 1024;

const codeExt = new Set(["ts", "tsx", "js", "jsx", "mjs", "py", "go", "rs", "rb", "java", "kt", "swift", "css", "html", "json", "sh", "sql", "yml", "yaml", "md"]);
const sheetExt = new Set(["csv", "tsv", "xls", "xlsx", "numbers"]);
const archiveExt = new Set(["zip", "tar", "gz", "rar", "7z"]);

const commandIcons: Record<string, LucideIcon> = { summarize: FileText, translate: Languages, explain: Lightbulb, fix: Wrench };

function fileKind(name: string, type: string): AttachmentKind {
  if (type.startsWith("image/")) return "image";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (codeExt.has(ext)) return "code";
  if (sheetExt.has(ext)) return "sheet";
  if (archiveExt.has(ext)) return "archive";
  if (ext === "txt") return "text";
  return "doc";
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

let attachmentCount = 0;
const attachmentId = () => `att-${Date.now().toString(36)}-${(attachmentCount += 1)}`;

type Option = { id: string; command?: ComposerCommand; context?: ComposerContext; group?: string };
type Dictation = { startedAt: number; phase: "listening" | "transcribing" };

/** Draws the text under the transparent textarea, with tokens as marks and an anchor for the list. */
function Mirror({
  text,
  placeholder,
  ranges,
  anchor,
  anchorRef,
}: {
  text: string;
  placeholder: string;
  ranges: TokenRange[];
  anchor: number | null;
  anchorRef: RefObject<HTMLSpanElement | null>;
}) {
  if (!text) return <span className="aic-mirrorPlaceholder">{placeholder}</span>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  const pushText = (to: number) => {
    if (to <= cursor) return;
    if (anchor !== null && anchor >= cursor && anchor < to) {
      parts.push(text.slice(cursor, anchor), <span key="anchor" ref={anchorRef} />, text.slice(anchor, to));
    } else {
      parts.push(text.slice(cursor, to));
    }
    cursor = to;
  };
  for (const range of ranges) {
    pushText(range.start);
    parts.push(
      <mark key={range.start} className="aic-token" data-kind={range.text.startsWith("/") ? "command" : "mention"}>
        {range.text}
      </mark>,
    );
    cursor = range.end;
  }
  pushText(text.length);
  return (
    <>
      {parts}
      {"\u200b"}
    </>
  );
}

export type ComposerHandle = {
  focus: () => void;
  fill: (prompt: string) => void;
  addFiles: (files: File[]) => void;
};

export type ComposerDraft = { text: string; tokens: string[]; attachments: Attachment[] };

type ComposerProps = {
  models: ComposerModel[];
  model: ComposerModel;
  effort: Effort;
  webSearch: boolean;
  thinking: boolean;
  onModel: (id: string) => void;
  onEffort: (effort: Effort) => void;
  onTool: (tool: "search" | "thinking") => void;
  busy: boolean;
  progress: number | null;
  progressSeconds: number;
  run: number;
  placeholder: string;
  maxLength: number;
  reduced: boolean;
  onSubmit: (draft: ComposerDraft) => void;
  onStop: () => void;
  announce: (message: string) => void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref) {
  const {
    models,
    model,
    effort,
    webSearch,
    thinking,
    onModel,
    onEffort,
    onTool,
    busy,
    progress,
    progressSeconds,
    run,
    placeholder,
    maxLength,
    reduced,
    onSubmit,
    onStop,
    announce,
  } = props;

  const [text, setText] = useState("");
  const [tokenList, setTokenList] = useState<string[]>([]);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dictation, setDictation] = useState<Dictation | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [popAt, setPopAt] = useState<{ left: number; bottom: number } | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastCaret = useRef(0);
  const dictationCaret = useRef<number | null>(null);
  const objectUrls = useRef(new Set<string>());
  const listId = useId();
  const hintId = useId();

  const ranges = useMemo(() => tokenRanges(text, tokenList), [text, tokenList]);
  const rawTrigger = useMemo(() => (focused && !dictation ? findTrigger(text, caret, ranges) : null), [focused, dictation, text, caret, ranges]);
  const trigger = rawTrigger && rawTrigger.start !== dismissed ? rawTrigger : null;

  const options = useMemo<Option[]>(() => {
    if (!trigger) return [];
    const query = trigger.query.toLowerCase();
    return trigger.type === "/"
      ? sampleCommands.filter((command) => command.id.startsWith(query)).map((command) => ({ id: command.id, command }))
      : sampleContexts
          .filter((context) => context.label.toLowerCase().includes(query) || context.meta.toLowerCase().includes(query))
          .map((context) => ({ id: context.id, group: context.group, context }));
  }, [trigger]);

  const listOpen = !!(trigger && (options.length || trigger.type === "@"));
  const listKey = trigger ? `${trigger.type}${trigger.start}${trigger.query}` : "";
  const activeIndex = Math.min(highlight.key === listKey ? highlight.index : 0, Math.max(0, options.length - 1));
  const setActive = (index: number) => setHighlight({ key: listKey, index });
  const activeOption = listOpen ? options[activeIndex] : undefined;

  /* The field height follows the mirror instead of measuring scrollHeight on every keystroke. */
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const observer = new ResizeObserver(() => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(mirror.offsetHeight)))));
    observer.observe(mirror);
    return () => observer.disconnect();
  }, []);

  /* The list sits above the line being typed and stays inside the composer's width. */
  const triggerStart = trigger?.start;
  useLayoutEffect(() => {
    if (!listOpen) return;
    const anchor = anchorRef.current;
    const surface = surfaceRef.current;
    if (!anchor || !surface) return;
    const a = anchor.getBoundingClientRect();
    const s = surface.getBoundingClientRect();
    const width = Math.min(300, s.width - 12);
    const left = Math.max(6, Math.min(a.left - s.left - 12, s.width - width - 6));
    const bottom = s.bottom - a.top + 8;
    setPopAt((current) => (current && current.left === left && current.bottom === bottom ? current : { left, bottom }));
  }, [listOpen, triggerStart, text, height]);

  /* Simulated uploads: each chip fills its ring, shows a check, then offers remove. */
  const uploading = attachments.some((item) => item.status === "uploading");
  useEffect(() => {
    if (!uploading) return;
    const interval = window.setInterval(() => {
      setAttachments((items) =>
        items.map((item) => {
          if (item.status !== "uploading") return item;
          const total = 700 + Math.min(1800, item.size / 6000);
          const next = Math.min(1, item.progress + 60 / total);
          return next >= 1 ? { ...item, progress: 1, status: "done" } : { ...item, progress: next };
        }),
      );
    }, 60);
    return () => window.clearInterval(interval);
  }, [uploading]);

  const doneIds = attachments
    .filter((item) => item.status === "done")
    .map((item) => item.id)
    .join(",");
  useEffect(() => {
    if (!doneIds) return;
    const ids = doneIds.split(",");
    const names = attachments.filter((item) => ids.includes(item.id)).map((item) => item.name);
    announce(names.length === 1 ? `${names[0]} uploaded` : `${names.length} files uploaded`);
    const timer = window.setTimeout(
      () => setAttachments((items) => items.map((item) => (ids.includes(item.id) && item.status === "done" ? { ...item, status: "ready" } : item))),
      900,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneIds]);

  /* Object URLs for image thumbnails are revoked when the block unmounts. */
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const focusAt = useCallback((position?: number) => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (position !== undefined) {
      input.setSelectionRange(position, position);
      lastCaret.current = position;
      setCaret(position);
    }
  }, []);

  /* Edits go through the browser's editing commands so undo and redo keep working. */
  const replaceRange = useCallback(
    (start: number, end: number, value: string) => {
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(start, end);
      const ok = value ? document.execCommand("insertText", false, value) : document.execCommand("delete");
      if (!ok) {
        setText(input.value.slice(0, start) + value + input.value.slice(end));
        requestAnimationFrame(() => focusAt(start + value.length));
      }
      const position = start + value.length;
      lastCaret.current = position;
      setCaret(position);
    },
    [focusAt],
  );

  const addAttachments = useCallback(
    (items: Attachment[]) => {
      if (!items.length) return;
      setAttachments((current) => [...current, ...items]);
      const failed = items.filter((item) => item.status === "error");
      if (failed.length) announce(`${failed.map((item) => item.name).join(", ")} is over the 30 MB limit`);
      else announce(items.length === 1 ? `Uploading ${items[0]?.name}` : `Uploading ${items.length} files`);
    },
    [announce],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      addAttachments(
        files.map((file) => {
          const kind = fileKind(file.name, file.type);
          const thumb = kind === "image" ? URL.createObjectURL(file) : undefined;
          if (thumb) objectUrls.current.add(thumb);
          const tooBig = file.size > SIZE_LIMIT;
          const ext = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() : undefined;
          return {
            id: attachmentId(),
            source: "file",
            kind,
            name: file.name || "Pasted image",
            size: file.size,
            file,
            thumb,
            meta: `${kind === "image" ? "Image" : (ext ?? "File")}, ${formatSize(file.size)}`,
            status: tooBig ? "error" : "uploading",
            progress: 0,
            error: tooBig ? "Over 30 MB" : undefined,
          } satisfies Attachment;
        }),
      );
    },
    [addAttachments],
  );

  const fill = useCallback(
    (prompt: string) => {
      setTokenList(knownTokens.filter((token) => prompt.includes(token)));
      const input = inputRef.current;
      if (!input) return;
      replaceRange(0, input.value.length, prompt);
      if (input.value !== prompt) setText(prompt);
    },
    [replaceRange],
  );

  function pick(option: Option) {
    if (!trigger) return;
    const token = option.command ? option.command.label : `@${option.context?.label ?? ""}`;
    setTokenList((current) => [...current, token]);
    replaceRange(trigger.start, caret, `${token} `);
    announce(option.command ? `${token} command added` : `${option.context?.label} added as context`);
  }

  useImperativeHandle(ref, () => ({ focus: () => focusAt(), fill, addFiles }), [focusAt, fill, addFiles]);

  const hasText = text.trim().length > 0;
  const sendable = attachments.filter((item) => item.status !== "error");
  const overLimit = text.length > maxLength;
  const sendState: SendState = busy ? "generating" : hasText || sendable.length ? (uploading || overLimit || dictation ? "blocked" : "ready") : "empty";
  const sendLabel =
    sendState === "generating"
      ? "Stop generating"
      : sendState === "empty"
        ? "Send message"
        : uploading
          ? "Send, after uploads finish"
          : overLimit
            ? "Send, message is over the limit"
            : "Send message";

  function submit() {
    if (sendState !== "ready") return;
    const used = tokenRanges(text, tokenList).map((range) => range.text);
    onSubmit({ text: text.trim(), tokens: [...new Set(used)], attachments: sendable });
    setText("");
    setTokenList([]);
    setAttachments([]);
    setCaret(0);
    lastCaret.current = 0;
  }

  const addSimulated = (item: Omit<Attachment, "id" | "status" | "progress">, message: string) => {
    setAttachments((current) => [...current, { ...item, id: attachmentId(), status: "uploading", progress: 0 }]);
    announce(message);
  };

  function removeAttachment(id: string) {
    const item = attachments.find((entry) => entry.id === id);
    if (item?.thumb?.startsWith("blob:")) {
      URL.revokeObjectURL(item.thumb);
      objectUrls.current.delete(item.thumb);
    }
    if (item) announce(item.status === "uploading" ? `Upload of ${item.name} canceled` : `${item.name} removed`);
    setAttachments((current) => current.filter((entry) => entry.id !== id));
    focusAt();
  }

  function cancelDictation() {
    setDictation(null);
    announce("Dictation canceled");
    focusAt();
  }

  const finishDictation = useCallback(() => {
    setDictation((current) => (current && current.phase === "listening" ? { ...current, phase: "transcribing" } : current));
  }, []);

  const dictationPhase = dictation?.phase;
  const dictationStart = dictation?.startedAt;
  useEffect(() => {
    if (!dictationPhase || !dictationStart) return;
    if (dictationPhase === "listening") {
      const timer = window.setTimeout(finishDictation, 5600);
      return () => window.clearTimeout(timer);
    }
    const heard = Math.min(1, (Date.now() - dictationStart) / SPEECH_MS);
    const timer = window.setTimeout(
      () => {
        const words = dictationTranscript.split(" ");
        const count = heard >= 1 ? words.length : Math.max(0, Math.round(words.length * heard));
        const transcript = words.slice(0, count).join(" ");
        setDictation(null);
        if (!transcript) {
          announce("Nothing was heard");
          focusAt();
          return;
        }
        const input = inputRef.current;
        const at = Math.min(dictationCaret.current ?? text.length, input?.value.length ?? 0);
        const before = input?.value.slice(0, at) ?? "";
        const gap = before && !/\s$/.test(before) ? " " : "";
        requestAnimationFrame(() => {
          replaceRange(at, at, `${gap}${transcript}`);
          announce(`Inserted: ${transcript}`);
        });
      },
      reduced ? 120 : 520,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictationPhase, dictationStart]);

  const showCounter = text.length >= maxLength * 0.8;
  const counterTone = overLimit ? "over" : showCounter ? "near" : "calm";
  useEffect(() => {
    if (counterTone === "near") announce(`${(maxLength - text.length).toLocaleString("en-US")} characters left`);
    else if (counterTone === "over") announce(`Over the ${maxLength.toLocaleString("en-US")} character limit. Shorten the message to send it`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterTone]);

  const groups =
    trigger?.type === "@"
      ? (["Files", "Docs"] as const)
          .map((name) => ({ name, items: options.filter((option) => option.group === name) }))
          .filter((group) => group.items.length)
      : null;

  const optionId = (option: Option) => `${listId}-${option.id}`;

  const renderOption = (option: Option) => {
    const selected = option === activeOption;
    const Icon = option.command ? (commandIcons[option.command.id] ?? FileText) : null;
    return (
      <div
        key={option.id}
        id={optionId(option)}
        role="option"
        aria-selected={selected}
        className="aic-option"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => pick(option)}
        onMouseMove={() => {
          if (!selected) setActive(options.indexOf(option));
        }}
      >
        {Icon ? <Icon className="aic-optionGlyph" aria-hidden="true" /> : option.context ? <ContextGlyph kind={option.context.kind} /> : null}
        <span className="aic-optionText">
          <span className="aic-optionLabel">{option.command?.label ?? option.context?.label}</span>
          <span className="aic-optionHint">{option.command?.hint ?? option.context?.meta}</span>
        </span>
      </div>
    );
  };

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    const position = event.target.selectionStart;
    setText(value);
    setTokenList((current) => current.filter((token) => tokenRanges(value, [token]).length));
    if (dismissed !== null && !findTrigger(value, position, tokenRanges(value, tokenList))) setDismissed(null);
    lastCaret.current = position;
    setCaret(position);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const input = event.currentTarget;
    if (listOpen && trigger) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (options.length) setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && activeOption) {
        event.preventDefault();
        pick(activeOption);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(trigger.start);
        return;
      }
    }
    if (event.key === "Escape") {
      if (dictation) {
        event.preventDefault();
        cancelDictation();
        return;
      }
      if (busy) {
        event.preventDefault();
        onStop();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
      return;
    }
    /* Backspace and Delete remove a whole token at once. */
    const position = input.selectionStart;
    if (position === input.selectionEnd) {
      if (event.key === "Backspace") {
        const range = ranges.find((entry) => entry.end === position);
        if (range) {
          event.preventDefault();
          replaceRange(range.start, range.end, "");
        }
      } else if (event.key === "Delete") {
        const range = ranges.find((entry) => entry.start === position);
        if (range) {
          event.preventDefault();
          replaceRange(range.start, range.end, "");
        }
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length) {
      event.preventDefault();
      addFiles(files);
      return;
    }
    const pasted = event.clipboardData.getData("text/plain");
    const lines = pasted.split(/\r\n|\r|\n/).length;
    if (lines < 12 && pasted.length < 1200) return;
    event.preventDefault();
    const chip: Attachment = {
      id: attachmentId(),
      source: "paste",
      kind: "text",
      name: "Pasted text",
      meta: `${lines} ${lines === 1 ? "line" : "lines"}`,
      size: pasted.length,
      status: "ready",
      progress: 1,
      text: pasted,
    };
    setAttachments((current) => [...current, chip]);
    announce(`Long paste added as an attachment, ${lines} lines`);
  }

  /* Arrow keys and clicks hop over a token instead of landing inside it. */
  function handleSelect(input: HTMLTextAreaElement) {
    const position = input.selectionStart;
    if (position === input.selectionEnd) {
      const range = ranges.find((entry) => position > entry.start && position < entry.end);
      if (range) {
        const next =
          Math.abs(position - lastCaret.current) <= 1
            ? position > lastCaret.current
              ? range.end
              : range.start
            : position - range.start < range.end - position
              ? range.start
              : range.end;
        input.setSelectionRange(next, next);
        lastCaret.current = next;
        setCaret(next);
        return;
      }
    }
    lastCaret.current = position;
    setCaret(position);
  }

  return (
    <div className="aic-composer">
      <div
        ref={surfaceRef}
        className="aic-surface"
        data-focused={focused || undefined}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (target === event.currentTarget || target.dataset.focusArea !== undefined) {
            event.preventDefault();
            focusAt();
          }
        }}
      >
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div
              key="attachments"
              className="aic-attachmentsClip"
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
              transition={reduced ? { duration: duration.fast } : spring.smooth}
            >
              <ul className="aic-attachments" aria-label="Attachments">
                <AnimatePresence initial={false} mode="popLayout">
                  {attachments.map((item) => (
                    <AttachmentChip key={item.id} item={item} reduced={reduced} onRemove={removeAttachment} />
                  ))}
                </AnimatePresence>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="aic-field" data-focus-area="" data-dictating={dictation ? "" : undefined}>
          <div ref={backdropRef} className="aic-backdrop" aria-hidden="true">
            <div ref={mirrorRef} className="aic-mirror">
              <Mirror text={text} placeholder={placeholder} ranges={ranges} anchor={listOpen ? (trigger?.start ?? null) : null} anchorRef={anchorRef} />
            </div>
          </div>
          <textarea
            ref={inputRef}
            className="aic-input"
            value={text}
            rows={1}
            placeholder={placeholder}
            aria-label="Message"
            aria-describedby={hintId}
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
            aria-autocomplete="list"
            readOnly={!!dictation}
            spellCheck
            style={{ height, overflowY: height >= MAX_HEIGHT ? "auto" : "hidden" }}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={(event) => handleSelect(event.currentTarget)}
            onScroll={(event) => {
              if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <span id={hintId} className="aic-srOnly">
            Enter sends, Shift Enter adds a line. Type slash for commands and at for files and docs.
          </span>

          <AnimatePresence>
            {dictation && (
              <motion.div
                key="dictation"
                className="aic-dictation"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: duration.fast } }}
                transition={{ duration: duration.standard, ease: ease.enter }}
              >
                <Tooltip content="Cancel dictation">
                  <button type="button" className="aic-dictationButton" aria-label="Cancel dictation" onClick={cancelDictation}>
                    <X aria-hidden="true" />
                  </button>
                </Tooltip>
                {dictation.phase === "listening" ? (
                  <Wave startedAt={dictation.startedAt} speechMs={SPEECH_MS} reduced={reduced} />
                ) : (
                  <span className="aic-transcribing">
                    <TextShimmer>Transcribing</TextShimmer>
                  </span>
                )}
                <Timer from={dictation.startedAt} />
                <Tooltip content="Insert the transcript">
                  <button
                    type="button"
                    className={cx("aic-dictationButton", "aic-dictationDone")}
                    aria-label="Insert the transcript"
                    onClick={finishDictation}
                    disabled={dictation.phase !== "listening"}
                  >
                    <Check aria-hidden="true" />
                  </button>
                </Tooltip>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="aic-toolbar">
          <div className="aic-toolGroup">
            <AttachMenu
              onUpload={() => fileRef.current?.click()}
              onDrive={() =>
                addSimulated(
                  { source: "drive", kind: "sheet", name: "Q4 pricing model", meta: "Google Sheets, 412 KB", size: 412e3 },
                  "Adding Q4 pricing model from Google Drive, simulated",
                )
              }
              onGithub={() =>
                addSimulated(
                  { source: "github", kind: "code", name: "acme/storefront", meta: "main, 214 files", size: 24e5 },
                  "Adding acme/storefront from GitHub, simulated",
                )
              }
              onScreenshot={() =>
                addSimulated(
                  { source: "screenshot", kind: "image", name: "Screenshot 2026-10-20 at 14.32.png", meta: "Image, 284 KB", size: 284e3, thumb: screenshotThumb },
                  "Screenshot captured, simulated",
                )
              }
              onMention={() => {
                const input = inputRef.current;
                if (!input) return;
                const start = input.selectionStart ?? input.value.length;
                const needsSpace = start > 0 && !/\s/.test(input.value[start - 1] ?? "");
                requestAnimationFrame(() => replaceRange(start, input.selectionEnd ?? start, needsSpace ? " @" : "@"));
              }}
              onClosedAfterPick={() => focusAt()}
            />
            <ToolChip tool="search" on={webSearch} onToggle={() => onTool("search")} />
            <ToolChip tool="thinking" on={thinking} onToggle={() => onTool("thinking")} />
          </div>
          <div className="aic-toolGroup">
            <AnimatePresence initial={false}>
              {showCounter && (
                <motion.span
                  key="counter"
                  className="aic-counterWrap"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, width: 0 }}
                  transition={reduced ? { duration: duration.fast } : quick}
                >
                  <Counter length={text.length} max={maxLength} />
                </motion.span>
              )}
            </AnimatePresence>
            <ModelMenu models={models} model={model} effort={effort} reduced={reduced} onModel={onModel} onEffort={onEffort} />
            <Tooltip content={dictation ? "Insert the transcript" : "Dictate"}>
              <button
                type="button"
                className="aic-iconButton"
                aria-label={dictation ? "Stop dictation and insert" : "Dictate"}
                aria-pressed={!!dictation}
                data-live={dictation ? "" : undefined}
                onClick={() => {
                  if (dictation) {
                    finishDictation();
                    return;
                  }
                  dictationCaret.current = inputRef.current?.selectionStart ?? text.length;
                  setDictation({ startedAt: Date.now(), phase: "listening" });
                  announce("Listening. Dictation is simulated in this preview");
                }}
                disabled={busy && !dictation}
              >
                <Mic aria-hidden="true" />
              </button>
            </Tooltip>
            <SendButton
              state={sendState}
              progress={progress}
              progressSeconds={progressSeconds}
              run={run}
              label={sendLabel}
              reduced={reduced}
              onSend={submit}
              onStop={onStop}
            />
          </div>
        </div>

        <AnimatePresence>
          {listOpen && popAt && trigger && (
            <motion.div
              key={trigger.type}
              id={listId}
              role="listbox"
              aria-label={trigger.type === "/" ? "Commands" : "Files and docs"}
              className="aic-pop"
              style={{ left: popAt.left, bottom: popAt.bottom }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 4, scale: 0.99, transition: { duration: duration.instant } }}
              transition={reduced ? { duration: duration.instant } : quick}
            >
              {groups ? (
                groups.length ? (
                  groups.map((group) => (
                    <div key={group.name} role="group" aria-label={group.name}>
                      <div className="aic-popGroup" aria-hidden="true">
                        {group.name}
                      </div>
                      {group.items.map(renderOption)}
                    </div>
                  ))
                ) : (
                  <div className="aic-popEmpty">No files or docs match “{trigger.query}”</div>
                )
              ) : (
                options.map(renderOption)
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
          focusAt();
        }}
      />
    </div>
  );
});
