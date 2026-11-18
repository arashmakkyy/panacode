import type { Mark } from "./marks";

export interface ChatModel {
  id: string;
  name: string;
  note?: string;
  /** Any SVG component. */
  mark: Mark;
  /** Tints a mono mark. */
  color?: string;
}

export interface ChatSource {
  title: string;
  url: string;
  snippet?: string;
  mark?: Mark;
  color?: string;
}

export type ChatToolIcon = "search" | "database" | "code" | "file";

export interface ChatTool {
  id: string;
  name: string;
  /** Label while the tool is running, e.g. "Searching the web". */
  activeName?: string;
  status: "running" | "done" | "error";
  /** Short result such as "4 sources" or "40,213,880 rows". */
  summary?: string;
  icon?: ChatToolIcon;
  mark?: Mark;
  color?: string;
  input?: string[];
  output?: string;
  sources?: ChatSource[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface AiChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  model?: string;
  reasoning?: string;
  thoughtFor?: number;
  tools?: ChatTool[];
  sources?: ChatSource[];
  status?: "done" | "stopped" | "error";
  error?: string;
}

export type ChatStreamEvent =
  | { type: "reasoning"; delta: string }
  | { type: "reasoning-end"; seconds?: number }
  | { type: "tool"; tool: ChatTool }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "text"; delta: string }
  | { type: "error"; message: string };

export type ChatRespond = (
  messages: AiChatMessage[],
  options: { signal: AbortSignal; model: ChatModel },
) => AsyncIterable<ChatStreamEvent>;

export interface AiChatHistoryItem {
  id: string;
  title: string;
  group?: string;
  messages: AiChatMessage[];
}

export interface ChatSuggestion {
  label: string;
  prompt?: string;
  icon?: "database" | "timer" | "activity" | "search";
}

export interface AiChatProps {
  /** Streams one reply for the messages on screen. Without it the chat answers with simulated replies. */
  respond?: ChatRespond;
  models?: ChatModel[];
  defaultModel?: string;
  initialMessages?: AiChatMessage[];
  title?: string;
  history?: AiChatHistoryItem[];
  suggestions?: ChatSuggestion[];
  greeting?: string;
  placeholder?: string;
  autoPlay?: boolean;
  onFeedback?: (message: AiChatMessage, value: "up" | "down" | null) => void;
  onModelChange?: (model: ChatModel) => void;
  onNewChat?: () => void;
  className?: string;
}
