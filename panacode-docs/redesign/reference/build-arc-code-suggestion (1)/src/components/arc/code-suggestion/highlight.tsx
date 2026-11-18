import { memo, type ReactNode } from "react";

/**
 * A small TypeScript and JavaScript tokenizer for single lines. Other languages
 * still render cleanly in the plain text color.
 */

type TokenKind = "plain" | "keyword" | "string" | "number" | "function" | "type" | "punct" | "comment";
type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "default",
  "delete", "do", "else", "enum", "export", "extends", "finally", "for", "from", "function", "if",
  "implements", "import", "in", "instanceof", "interface", "let", "new", "of", "private", "public",
  "readonly", "return", "static", "switch", "throw", "try", "type", "typeof", "var", "void",
  "while", "yield",
]);

const LITERALS = new Set(["true", "false", "null", "undefined", "this"]);

const isDigit = (ch: string) => ch >= "0" && ch <= "9";
const isWordStart = (ch: string) => /[A-Za-z_$]/.test(ch);
const isWordPart = (ch: string) => /[\w$]/.test(ch);

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (kind === "plain" && last?.kind === "plain") last.text += text;
    else tokens.push({ kind, text });
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    // Line comment runs to the end.
    if (ch === "/" && line[i + 1] === "/") {
      push("comment", line.slice(i));
      break;
    }

    // Strings, including unterminated ones while a line is still streaming.
    if (ch === '"' || ch === "'" || ch === "`") {
      let end = i + 1;
      while (end < line.length && line[end] !== ch) end += line[end] === "\\" ? 2 : 1;
      end = Math.min(end + 1, line.length);
      const text = line.slice(i, end);
      if (ch === "`") {
        // Template literal: interpolations read as punctuation, the rest as string.
        for (const part of text.split(/(\$\{[^}]*\})/)) {
          if (part) push(part.startsWith("${") ? "punct" : "string", part);
        }
      } else {
        push("string", text);
      }
      i = end;
      continue;
    }

    if (isDigit(ch)) {
      let end = i + 1;
      while (end < line.length && /[\w.]/.test(line[end])) end++;
      push("number", line.slice(i, end));
      i = end;
      continue;
    }

    if (isWordStart(ch)) {
      let end = i + 1;
      while (end < line.length && isWordPart(line[end])) end++;
      const word = line.slice(i, end);
      const next = line.slice(end).match(/^\s*(.)/)?.[1];
      const kind: TokenKind = KEYWORDS.has(word)
        ? "keyword"
        : LITERALS.has(word)
          ? "number"
          : next === "("
            ? "function"
            : /^[A-Z]/.test(word)
              ? "type"
              : "plain";
      push(kind, word);
      i = end;
      continue;
    }

    push("plain", ch);
    i++;
  }

  return tokens;
}

const CLASS_NAME: Record<Exclude<TokenKind, "plain">, string> = {
  keyword: "cs-t-keyword",
  string: "cs-t-string",
  number: "cs-t-number",
  function: "cs-t-function",
  type: "cs-t-type",
  punct: "cs-t-punct",
  comment: "cs-t-comment",
};

/** Each distinct line is highlighted once, so streaming a line never redoes the others. */
const cache = new Map<string, ReactNode[]>();

function highlight(line: string): ReactNode[] {
  const cached = cache.get(line);
  if (cached) return cached;
  const nodes = tokenize(line).map((token, index) =>
    token.kind === "plain" ? (
      token.text
    ) : (
      <span key={index} className={CLASS_NAME[token.kind]}>
        {token.text}
      </span>
    ),
  );
  if (cache.size > 2000) cache.clear();
  cache.set(line, nodes);
  return nodes;
}

/** One highlighted line. Empty lines keep their height with a zero width space. */
export const CodeLine = memo(function CodeLine({ text }: { text: string }) {
  return <span className="cs-text">{text ? highlight(text) : "\u200B"}</span>;
});
