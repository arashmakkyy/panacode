import { memo, type ReactNode } from "react";
import { Globe } from "lucide-react";
import s from "./chat.module.css";
import type { ChatSource } from "./types";
import { CopyButton, HoverCard, cx } from "./ui";

/* ---------------------------------------------------------------- parser */

type Segment =
  | { text: string; start: number; strong: boolean; code: boolean }
  | { cite: number; start: number };

interface TextBlock {
  kind: "p" | "h";
  start: number;
  segments: Segment[];
}

interface ListBlock {
  kind: "ol" | "ul";
  start: number;
  first: number;
  items: Array<{ start: number; segments: Segment[] }>;
}

interface CodeBlock {
  kind: "code";
  start: number;
  lang: string;
  code: string;
  codeStart: number;
  closed: boolean;
}

type Block = TextBlock | ListBlock | CodeBlock;

const LIST_ITEM = /^(\s*)(\d+\.|[-*])\s+/;
const HEADING = /^#{1,4}\s+/;
export const FENCE = /^\s*```/;

/** Splits one line into plain, bold and code runs plus [n] citations, keeping source offsets. */
function inline(line: string, offset: number, out: Segment[]) {
  let strong = false;
  let code = false;
  let text = "";
  let start = offset;

  const flush = (next: number) => {
    if (text) out.push({ text, start, strong, code });
    text = "";
    start = next;
  };

  for (let i = 0; i < line.length; ) {
    if (!code && line.startsWith("**", i)) {
      flush(offset + i + 2);
      strong = !strong;
      i += 2;
      continue;
    }
    if (line[i] === "`") {
      flush(offset + i + 1);
      code = !code;
      i += 1;
      continue;
    }
    if (!code && line[i] === "[") {
      const match = /^\[(\d{1,2})\]/.exec(line.slice(i, i + 5));
      if (match) {
        flush(offset + i + match[0].length);
        out.push({ cite: Number(match[1]), start: offset + i });
        i += match[0].length;
        continue;
      }
    }
    if (!text) start = offset + i;
    text += line[i];
    i += 1;
  }
  flush(offset + line.length);
}

/** A small linear parser: paragraphs, lists, short headings and fenced code. */
function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  const offsets: number[] = [];
  lines.reduce((at, line) => {
    offsets.push(at);
    return at + line.length + 1;
  }, 0);

  let paragraph: TextBlock | null = null;
  let list: ListBlock | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const at = offsets[i];

    if (FENCE.test(line)) {
      paragraph = null;
      list = null;
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== "```") body.push(lines[end++]);
      blocks.push({
        kind: "code",
        start: at,
        lang,
        code: body.join("\n"),
        codeStart: offsets[i + 1] ?? source.length,
        closed: end < lines.length,
      });
      i = end + 1;
      continue;
    }

    if (!line.trim()) {
      paragraph = null;
      list = null;
      i += 1;
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      paragraph = null;
      const kind = item[2].endsWith(".") ? "ol" : "ul";
      if (!list || list.kind !== kind) {
        list = { kind, start: at, first: kind === "ol" ? parseInt(item[2], 10) : 1, items: [] };
        blocks.push(list);
      }
      const segments: Segment[] = [];
      inline(line.slice(item[0].length), at + item[0].length, segments);
      list.items.push({ start: at, segments });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      list = null;
      paragraph = null;
      const block: TextBlock = { kind: "h", start: at, segments: [] };
      inline(line.slice(heading[0].length), at + heading[0].length, block.segments);
      blocks.push(block);
      i += 1;
      continue;
    }

    const open: Segment[] | undefined = list ? list.items[list.items.length - 1].segments : paragraph?.segments;
    if (open) {
      open.push({ text: " ", start: at - 1, strong: false, code: false });
      inline(line.trim(), at + (line.length - line.trimStart().length), open);
    } else {
      paragraph = { kind: "p", start: at, segments: [] };
      inline(line, at, paragraph.segments);
      blocks.push(paragraph);
    }
    i += 1;
  }

  return blocks;
}

/* -------------------------------------------------------------- renderer */

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * While a reply streams, `marks` holds the offsets where each chunk began. Every chunk becomes
 * its own span that fades in once, so nothing already on screen re-renders or moves.
 */
function chunked(
  text: string,
  start: number,
  marks: number[] | undefined,
  render: (part: string) => ReactNode = (part) => part,
): ReactNode {
  if (!marks) return render(text);
  const end = start + text.length;
  const parts: ReactNode[] = [];
  let at = start;
  for (const mark of marks) {
    if (mark <= at) continue;
    if (mark >= end) break;
    parts.push(
      <span key={at} className={s.chunk}>
        {render(text.slice(at - start, mark - start))}
      </span>,
    );
    at = mark;
  }
  parts.push(
    <span key={at} className={s.chunk}>
      {render(text.slice(at - start))}
    </span>,
  );
  return parts;
}

const SQL_TOKENS =
  /\b(SELECT|FROM|WHERE|AND|OR|NOT|NULL|IS|ALTER|TABLE|ADD|COLUMN|CONSTRAINT|CHECK|VALID|VALIDATE|SET|DROP|UPDATE|INSERT|INTO|VALUES|CREATE|INDEX|CONCURRENTLY|ON|AS|IN|BEGIN|COMMIT|text|bigint|integer|count|now)\b|('[^']*')|(\$\d+|\b\d[\d_]*\b)|(--.*$)/gm;

function highlight(code: string): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const match of code.matchAll(SQL_TOKENS)) {
    const index = match.index ?? 0;
    if (index > at) out.push(code.slice(at, index));
    const tone = match[1] ? s.tokKeyword : match[2] ? s.tokString : match[3] ? s.tokNumber : s.tokComment;
    out.push(
      <span key={index} className={tone}>
        {match[0]}
      </span>,
    );
    at = index + match[0].length;
  }
  if (at < code.length) out.push(code.slice(at));
  return out.length === 1 ? out[0] : out;
}

function SourcePreview({ source, n }: { source: ChatSource; n: number }) {
  const Mark = source.mark;
  return (
    <div className={s.sourcePreview}>
      <p className={s.sourceSite}>
        {Mark ? (
          <Mark className={s.sourceMark} style={{ color: source.color }} aria-hidden="true" />
        ) : (
          <Globe className={s.sourceMark} size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span>{hostOf(source.url)}</span>
        <span className={s.sourceN}>{n}</span>
      </p>
      <p className={s.sourceTitle}>{source.title}</p>
      {source.snippet && <p className={s.sourceSnippet}>{source.snippet}</p>}
    </div>
  );
}

function Citation({ n, source, fresh }: { n: number; source?: ChatSource; fresh: boolean }) {
  const className = cx(s.cite, fresh && s.chunk);
  if (!source) {
    return (
      <span className={className} data-missing="">
        {n}
      </span>
    );
  }
  return (
    <HoverCard
      side="top"
      align="center"
      openDelay={220}
      className={s.sourceCard}
      content={<SourcePreview source={source} n={n} />}
    >
      <a
        className={className}
        href={source.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Source ${n}: ${source.title}, ${hostOf(source.url)}`}
      >
        {n}
      </a>
    </HoverCard>
  );
}

function Inline({
  segments,
  marks,
  sources,
}: {
  segments: Segment[];
  marks?: number[];
  sources: ChatSource[];
}) {
  return segments.map((segment) => {
    if ("cite" in segment) {
      return (
        <Citation key={`c${segment.start}`} n={segment.cite} source={sources[segment.cite - 1]} fresh={!!marks} />
      );
    }
    const content = chunked(segment.text, segment.start, marks);
    if (segment.code) {
      return (
        <code key={segment.start} className={s.inlineCode}>
          {content}
        </code>
      );
    }
    if (segment.strong) {
      return (
        <strong key={segment.start} className={s.strong}>
          {content}
        </strong>
      );
    }
    return <span key={segment.start}>{content}</span>;
  });
}

function Code({ block, marks, reduced }: { block: CodeBlock; marks?: number[]; reduced: boolean }) {
  return (
    <div className={cx(s.codeBlock, marks && s.chunk)}>
      <div className={s.codeHead}>
        <span className={s.codeLang}>{block.lang || "code"}</span>
        <CopyButton value={block.code} label="Copy" className={s.codeCopy} disabled={!block.closed} reduced={reduced} />
      </div>
      <pre className={s.codePre}>
        <code>{chunked(block.code, block.codeStart, marks, highlight)}</code>
      </pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({
  source,
  shown,
  marks,
  sources = [],
  reduced = false,
}: {
  source: string;
  /** How much of the source has been revealed so far. */
  shown?: number;
  marks?: number[];
  sources?: ChatSource[];
  reduced?: boolean;
}) {
  const blocks = parse(shown === undefined ? source : source.slice(0, shown));

  return (
    <div className={s.markdown}>
      {blocks.map((block) => {
        if (block.kind === "code") {
          return <Code key={`code${block.start}`} block={block} marks={marks} reduced={reduced} />;
        }
        if (!("items" in block)) {
          return block.kind === "h" ? (
            <h3 key={`h${block.start}`} className={s.heading}>
              <Inline segments={block.segments} marks={marks} sources={sources} />
            </h3>
          ) : (
            <p key={`p${block.start}`} className={s.paragraph}>
              <Inline segments={block.segments} marks={marks} sources={sources} />
            </p>
          );
        }
        const items = block.items.map((item) => (
          <li key={item.start} className={marks ? s.chunk : undefined}>
            <Inline segments={item.segments} marks={marks} sources={sources} />
          </li>
        ));
        return block.kind === "ol" ? (
          <ol key={`ol${block.start}`} className={s.list} start={block.first !== 1 ? block.first : undefined}>
            {items}
          </ol>
        ) : (
          <ul key={`ul${block.start}`} className={s.list}>
            {items}
          </ul>
        );
      })}
    </div>
  );
});
