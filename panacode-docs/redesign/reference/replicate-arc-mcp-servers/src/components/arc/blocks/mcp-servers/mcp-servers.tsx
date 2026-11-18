"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, CircleAlert, KeyRound, Plus, Trash, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "../../button/button";
import SegmentedControl from "../../segmented-control/segmented-control";
import { ConnectSheet, type ConnectKind, type SheetMode } from "./connect-sheet";
import { contextTokens, formatTokens, plural, resolveTools, toolsOn } from "./format";
import { BrandMark, Count, McpMark, NorthwindMark, STATUS_LABEL, StatusLabel, Swap, TokenCount, ToolFields, cx, easeEnter, fadeIn, fadeOut, settle, still } from "./parts";
import { sampleAccount, sampleDirectory, sampleServers, simulatedFailures } from "./sample-data";
import type { McpConnectRequest, McpPermission, McpReportedTool, McpServer, McpServersProps } from "./types";
import styles from "./mcp-servers.module.css";

export type { McpAccess, McpAccount, McpBrand, McpConnectRequest, McpDirectoryEntry, McpPermission, McpReportedTool, McpServer, McpServersProps, McpStatus, McpTool, McpTransport } from "./types";

/** How long Undo stays available after a remove. */
const UNDO_WINDOW = 6000;
/** How long a row keeps its accent tint after it arrives, reconnects or comes back. */
const FRESH_WINDOW = 1700;
/** The card grows to at least this height while the sheet is open, so the directory has room. */
const SHEET_MIN_HEIGHT = 600;

const PERMISSIONS = [
  { value: "ask", label: "Ask every time" },
  { value: "allow-reads", label: "Always allow reads" },
];

interface PendingRemoval {
  server: McpServer;
  /** Where the server sat, so Undo opens it again in place. */
  index: number;
  key: number;
}

/**
 * Manages the MCP servers that give an agent its tools: what the enabled tool definitions cost in context, which
 * servers are connected, and which single tools are on.
 *
 * With no props it shows sample servers and simulates every connection. Pass `servers` and the callbacks to wire
 * your own MCP client.
 */
export function McpServers({
  servers: serversProp,
  directory = sampleDirectory,
  budget = 8000,
  title = "MCP servers",
  clientName = "Northwind agent",
  clientMark,
  account = sampleAccount,
  onToggleTool,
  onConnect,
  onRemove,
  onPermissionChange,
  className,
}: McpServersProps) {
  const demo = serversProp === undefined;
  const reduced = !!useReducedMotion();
  const titleId = `${useId()}-title`;

  const [servers, setServers] = useState<McpServer[]>(() => serversProp ?? sampleServers);
  // Passing a new array replaces the list.
  const [seenProp, setSeenProp] = useState(serversProp);
  if (serversProp !== seenProp) {
    setSeenProp(serversProp);
    if (serversProp) setServers(serversProp);
  }

  const [openId, setOpenId] = useState<string | null>(null);
  const [hotId, setHotId] = useState<string | null>(null);
  const [working, setWorking] = useState<Record<string, string>>({});
  const [removal, setRemoval] = useState<PendingRemoval | null>(null);
  const [undoHeld, setUndoHeld] = useState(false);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ id: string | null } | null>(null);

  const rootRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<string | null>(null);
  const failedOnce = useRef(new Set<string>());
  const alive = useRef(true);
  const timers = useRef(new Set<number>());

  // Callbacks and the pending removal, read from timers and promises that outlive a render.
  const latest = useRef({ removal, onConnect, onRemove });
  useLayoutEffect(() => {
    latest.current = { removal, onConnect, onRemove };
  });

  useEffect(() => {
    const pending = timers.current;
    alive.current = true;
    return () => {
      alive.current = false;
      pending.forEach(id => window.clearTimeout(id));
      pending.clear();
    };
  }, []);

  const later = useCallback((run: () => void, ms: number) => {
    if (!alive.current) return;
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }, []);

  /** Speaks through the polite status region. A repeated message gains a space so it is read again. */
  const announce = useCallback((text: string) => setMessage(previous => (previous === text ? `${text} ` : text)), []);

  /** Moves focus to a server's row once it is on screen, or to Add server when there is no such row. */
  const focusRow = useCallback((id: string | null) => setFocusRequest({ id }), []);

  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const head = focusRequest.id ? rootRef.current?.querySelector<HTMLElement>(`[data-head="${CSS.escape(focusRequest.id)}"]`) : null;
      (head ?? addRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  const flash = useCallback(
    (id: string) => {
      setFreshId(id);
      later(() => setFreshId(current => (current === id ? null : current)), FRESH_WINDOW);
    },
    [later],
  );

  /** Reaches a server through onConnect, or simulates the round trip when nothing is wired. */
  const connect = useCallback(
    (request: McpConnectRequest, known: McpReportedTool[]): Promise<McpReportedTool[]> => {
      const handler = latest.current.onConnect;
      if (handler) {
        return Promise.resolve()
          .then(() => handler(request))
          .then(reported => (Array.isArray(reported) ? reported : known));
      }
      return new Promise((resolve, reject) => {
        later(
          () => {
            if (demo && simulatedFailures.has(request.serverId) && !failedOnce.current.has(request.serverId)) {
              failedOnce.current.add(request.serverId);
              reject(new Error(`${request.name} closed the connection during tools/list. Simulated failure, try again.`));
            } else {
              resolve(known);
            }
          },
          request.kind === "retry" ? 1100 : 760,
        );
      });
    },
    [demo, later],
  );

  const totalTokens = servers.reduce((sum, server) => sum + contextTokens(server), 0);

  const toggleTool = (serverId: string, toolId: string, enabled: boolean) => {
    const server = servers.find(candidate => candidate.id === serverId);
    const tool = server?.tools.find(candidate => candidate.id === toolId);
    if (!server || !tool || tool.enabled === enabled) return;
    setServers(list => list.map(item => (item.id !== serverId ? item : { ...item, tools: item.tools.map(entry => (entry.id === toolId ? { ...entry, enabled } : entry)) })));
    onToggleTool?.(serverId, toolId, enabled);
    announce(`${tool.name} ${enabled ? "on" : "off"}. ${formatTokens(totalTokens + (enabled ? tool.tokens : -tool.tokens))} tokens of context.`);
  };

  const changePermission = (serverId: string, permission: McpPermission) => {
    const server = servers.find(candidate => candidate.id === serverId);
    if (!server || (server.permission ?? "ask") === permission) return;
    setServers(list => list.map(item => (item.id === serverId ? { ...item, permission } : item)));
    onPermissionChange?.(serverId, permission);
    announce(`${server.name}: ${permission === "ask" ? "ask before every tool call" : "read tools run without asking"}.`);
  };

  /** Closes the undo window: the removal becomes final and the host hears about it. */
  const commitRemoval = useCallback(() => {
    const pending = latest.current.removal;
    if (!pending) return;
    latest.current.removal = null;
    latest.current.onRemove?.(pending.server.id);
    setRemoval(null);
    setUndoHeld(false);
  }, []);

  const removeServer = (id: string) => {
    const index = servers.findIndex(candidate => candidate.id === id);
    if (index < 0) return;
    const server = servers[index];
    // Only one remove can be undone at a time, so an earlier one becomes final now.
    commitRemoval();
    const neighbour = servers[index + 1] ?? servers[index - 1] ?? null;
    setServers(list => list.filter(item => item.id !== id));
    setOpenId(current => (current === id ? null : current));
    setWorking(map => omit(map, id));
    setRemoval({ server, index, key: Date.now() });
    announce(`Removed ${server.name}. Undo is available for a few seconds.`);
    focusRow(neighbour?.id ?? null);
  };

  const undoRemoval = useCallback(() => {
    const pending = latest.current.removal;
    if (!pending) return;
    latest.current.removal = null;
    setRemoval(null);
    setUndoHeld(false);
    setServers(list => {
      if (list.some(item => item.id === pending.server.id)) return list;
      const next = [...list];
      next.splice(Math.min(pending.index, next.length), 0, pending.server);
      return next;
    });
    flash(pending.server.id);
    announce(`Restored ${pending.server.name}.`);
    focusRow(pending.server.id);
  }, [announce, flash, focusRow]);

  // The undo window. Resting the pointer or focus on the bar holds it open.
  useEffect(() => {
    if (!removal || undoHeld) return;
    const id = window.setTimeout(commitRemoval, UNDO_WINDOW);
    return () => window.clearTimeout(id);
  }, [removal, undoHeld, commitRemoval]);

  /** Retries a server in error, in place. */
  const retryServer = (id: string) => {
    const server = servers.find(candidate => candidate.id === id);
    if (!server || working[id]) return;
    // The Retry button is about to leave, so focus moves to the row.
    focusRow(id);
    setWorking(map => ({ ...map, [id]: "Connecting" }));
    announce(`Reconnecting to ${server.name}.`);
    connect({ kind: "retry", serverId: id, name: server.name, transport: server.transport, endpoint: server.endpoint }, server.tools)
      .then(reported => {
        if (!alive.current) return;
        const tools = resolveTools(server.tools, reported);
        const on = tools.filter(tool => tool.enabled).length;
        setServers(list => list.map(item => (item.id === id ? { ...item, status: "connected", error: undefined, tools } : item)));
        flash(id);
        announce(`${server.name} connected. ${on} ${plural(on, "tool", "tools")} on.`);
      })
      .catch((cause: unknown) => {
        if (!alive.current) return;
        const reason = cause instanceof Error && cause.message ? cause.message : "The server did not answer.";
        setServers(list => list.map(item => (item.id === id ? { ...item, status: "error", error: reason } : item)));
        announce(`${server.name} is still not answering. ${reason}`);
      })
      .finally(() => {
        if (alive.current) setWorking(map => omit(map, id));
      });
  };

  /** Scrolls the card's bottom edge into view when the sheet would otherwise open below the fold. */
  const revealSheet = useCallback(() => {
    const root = rootRef.current;
    if (root && root.getBoundingClientRect().bottom > window.innerHeight) root.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);

  const openSheet = (mode: SheetMode, from: string | null) => {
    returnTo.current = from;
    setHotId(null);
    setSheet(mode);
    requestAnimationFrame(revealSheet);
  };

  const closeSheet = () => {
    setSheet(null);
    focusRow(returnTo.current);
  };

  const finishConnect = (server: McpServer, kind: ConnectKind) => {
    setSheet(null);
    const on = server.tools.filter(tool => tool.enabled).length;
    if (kind === "reconnect") {
      setServers(list => list.map(item => (item.id === server.id ? { ...item, status: "connected", error: undefined, tools: server.tools } : item)));
      flash(server.id);
      announce(`${server.name} signed in. ${on} of ${server.tools.length} tools on.`);
      focusRow(server.id);
      return;
    }
    // A server that was removed a moment ago and is added again simply stays; there is nothing left to undo.
    if (latest.current.removal?.server.id === server.id) {
      latest.current.removal = null;
      setRemoval(null);
      setUndoHeld(false);
    }
    announce(`${server.name} added with ${on} of ${server.tools.length} tools on.${onConnect ? "" : " Simulated, nothing was connected."}`);
    // The sheet starts to leave first, then the new server slides into the top of the list.
    later(
      () => {
        setServers(list => [server, ...list.filter(item => item.id !== server.id)]);
        flash(server.id);
        focusRow(server.id);
      },
      reduced ? 0 : 180,
    );
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!removal || sheet) return;
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
    if ((event.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    undoRemoval();
  };

  const onHeadKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const heads = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-head]") ?? [])];
    const at = heads.findIndex(head => head.dataset.head === id);
    const next = event.key === "ArrowDown" ? heads[at + 1] : event.key === "ArrowUp" ? heads[at - 1] : event.key === "Home" ? heads[0] : event.key === "End" ? heads[heads.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <motion.section
      ref={rootRef}
      className={cx(styles.root, className)}
      aria-labelledby={titleId}
      onKeyDown={onRootKeyDown}
      initial={false}
      // Lengths carry their unit: a bare number is not a valid min-height, so the card would never grow.
      animate={{ minHeight: sheet ? `${SHEET_MIN_HEIGHT}px` : "0px" }}
      transition={reduced ? still : settle}
      onAnimationComplete={() => {
        if (sheet) revealSheet();
      }}
    >
      <div className={styles.main} inert={!!sheet}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <h2 id={titleId} className={styles.title}>
              <McpMark className={styles.titleMark} aria-hidden="true" />
              {title}
            </h2>
            <Button ref={addRef} variant="secondary" size="sm" className={styles.addButton} onClick={() => openSheet({ kind: "add" }, null)} aria-haspopup="dialog">
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              Add server
            </Button>
          </div>
          <ContextMeter servers={servers} budget={budget} hotId={hotId} reduced={reduced} />
        </header>

        <ul className={styles.list} aria-label="Connected servers">
          <AnimatePresence initial={false}>
            {servers.map(server => (
              <motion.li
                key={server.id}
                className={styles.item}
                initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={reduced ? { opacity: 0, transition: still } : { height: 0, opacity: 0, transition: { height: settle, opacity: { duration: 0.14 } } }}
                transition={reduced ? still : { height: settle, opacity: { ...fadeIn, delay: 0.04 } }}
              >
                <ServerRow
                  server={server}
                  open={openId === server.id}
                  fresh={freshId === server.id}
                  working={working[server.id] ?? null}
                  reduced={reduced}
                  onToggleOpen={id => setOpenId(current => (current === id ? null : id))}
                  onToggleTool={toggleTool}
                  onPermission={changePermission}
                  onSignIn={id => {
                    const target = servers.find(candidate => candidate.id === id);
                    if (target) openSheet({ kind: "reconnect", server: target }, id);
                  }}
                  onRetry={retryServer}
                  onRemove={removeServer}
                  onHot={setHotId}
                  onHeadKey={onHeadKey}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        <AnimatePresence initial={false}>
          {servers.length === 0 ? (
            <motion.div key="empty" className={styles.empty} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: reduced ? still : { ...fadeIn, delay: 0.18 } }} exit={{ opacity: 0, transition: reduced ? still : fadeOut }}>
              <McpMark className={styles.emptyMark} aria-hidden="true" />
              <p className={styles.emptyTitle}>No servers connected</p>
              <p className={styles.emptyText}>Connect a server to give the agent tools. Each tool you turn on adds its definition to the context.</p>
              <Button variant="secondary" size="sm" onClick={() => openSheet({ kind: "add" }, null)} aria-haspopup="dialog">
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                Add server
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {removal ? (
            <motion.div
              key="undo"
              className={styles.undoClip}
              initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduced ? { opacity: 0, transition: still } : { height: 0, opacity: 0, transition: { height: settle, opacity: { duration: 0.12 } } }}
              transition={reduced ? still : { height: settle, opacity: fadeIn }}
            >
              <div className={styles.undo} onPointerEnter={() => setUndoHeld(true)} onPointerLeave={() => setUndoHeld(false)} onFocus={() => setUndoHeld(true)} onBlur={() => setUndoHeld(false)}>
                <BrandMark brand={removal.server.brand} className={styles.undoMark} />
                <p className={styles.undoText}>Removed {removal.server.name}</p>
                <Button key={removal.key} variant="ghost" size="sm" className={styles.undoButton} onClick={undoRemoval}>
                  <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
                  Undo
                </Button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {sheet ? (
          // The layer has no motion of its own. It stays until the scrim and the sheet inside it have left.
          <motion.div key="layer" className={styles.layer} initial={{ opacity: 1 }} exit={{ opacity: 1, transition: { duration: reduced ? 0.12 : 0.28 } }}>
            <motion.div className={styles.scrim} aria-hidden="true" onClick={closeSheet} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2, ease: easeEnter }} />
            <ConnectSheet
              key={sheet.kind === "reconnect" ? `reconnect-${sheet.server.id}` : "add"}
              mode={sheet}
              directory={directory}
              connectedIds={servers.map(server => server.id)}
              clientName={clientName}
              clientMark={clientMark ?? <NorthwindMark aria-hidden="true" />}
              account={account}
              reduced={reduced}
              simulated={!onConnect}
              connect={connect}
              onClose={closeSheet}
              onDone={finishConnect}
              announce={announce}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {message}
      </p>
    </motion.section>
  );
}

export default McpServers;

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/* ------------------------------------------------------------------ Context meter */

interface ContextMeterProps {
  servers: McpServer[];
  budget: number;
  /** The server under the pointer or focus. Its segment takes the first series color and the others dim. */
  hotId: string | null;
  reduced: boolean;
}

/** What the enabled tool definitions cost in context, over a bar with one segment per server. */
function ContextMeter({ servers, budget, hotId, reduced }: ContextMeterProps) {
  const segments = servers.map(server => ({ id: server.id, name: server.name, tokens: contextTokens(server) })).filter(segment => segment.tokens > 0);
  const used = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  const tools = servers.reduce((sum, server) => sum + toolsOn(server), 0);
  // The bar spans the budget. Past it the bar rescales to what is used and the overflow turns amber.
  const span = Math.max(budget, used, 1);
  const over = used - budget;
  const focused = !!hotId && segments.some(segment => segment.id === hotId);

  return (
    <div className={styles.meter}>
      <div className={styles.meterLine}>
        <p className={styles.meterText}>
          <span className={styles.meterValue}>
            <Count value={tools} />
          </span>
          <Swap id={tools === 1 ? "one" : "many"} reduced={reduced}>
            {plural(tools, "tool", "tools")}
          </Swap>
          <span className={styles.meterDot} aria-hidden="true">
            ·
          </span>
          <span className={styles.meterValue}>
            <TokenCount value={used} />
          </span>
          <span>tokens of context</span>
        </p>
        <Swap id={over > 0 ? "over" : "under"} reduced={reduced} className={styles.budgetSlot}>
          {over > 0 ? (
            <span className={styles.budget} data-over="">
              <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
              {formatTokens(over)} over the {formatTokens(budget)} budget
            </span>
          ) : (
            <span className={styles.budget}>{formatTokens(budget)} budget</span>
          )}
        </Swap>
      </div>
      <div
        className={styles.track}
        data-focus={focused ? "" : undefined}
        role="meter"
        aria-label="Context used by tool definitions"
        aria-valuemin={0}
        aria-valuemax={span}
        aria-valuenow={used}
        aria-valuetext={`${used.toLocaleString("en-US")} of ${budget.toLocaleString("en-US")} budgeted tokens${over > 0 ? `, ${over.toLocaleString("en-US")} over` : ""}`}
      >
        <AnimatePresence initial={false}>
          {segments.map(segment => (
            <motion.span
              key={segment.id}
              className={styles.segment}
              data-hot={hotId === segment.id ? "" : undefined}
              title={`${segment.name}: ${formatTokens(segment.tokens)} tokens`}
              initial={{ width: "0%" }}
              animate={{ width: `${(segment.tokens / span) * 100}%` }}
              exit={{ width: "0%" }}
              transition={reduced ? still : settle}
            >
              <span className={styles.segmentFill} />
            </motion.span>
          ))}
        </AnimatePresence>
        <motion.span
          className={styles.overflow}
          aria-hidden="true"
          initial={false}
          animate={{ left: `${(budget / span) * 100}%`, opacity: over > 0 ? 1 : 0 }}
          transition={reduced ? still : { left: settle, opacity: { duration: 0.2 } }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Server row */

interface ServerRowProps {
  server: McpServer;
  open: boolean;
  fresh: boolean;
  /** "Connecting" while a retry is on its way, else null. */
  working: string | null;
  reduced: boolean;
  onToggleOpen: (id: string) => void;
  onToggleTool: (serverId: string, toolId: string, enabled: boolean) => void;
  onPermission: (serverId: string, permission: McpPermission) => void;
  onSignIn: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onHot: (id: string | null) => void;
  onHeadKey: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void;
}

function ServerRow({ server, open, fresh, working, reduced, onToggleOpen, onToggleTool, onPermission, onSignIn, onRetry, onRemove, onHot, onHeadKey }: ServerRowProps) {
  const uid = useId();
  const panelId = `${uid}-panel`;
  const live = server.status === "connected" && !working;
  const on = server.tools.filter(tool => tool.enabled).length;
  const tokens = contextTokens(server);
  const transport = server.transport === "remote" ? "Remote" : "Local";
  const action = working || server.status === "connected" ? null : server.status === "needs-auth" ? "Sign in" : "Retry";

  return (
    <div className={styles.row} data-open={open ? "" : undefined} data-fresh={fresh ? "" : undefined} onPointerEnter={() => onHot(server.id)} onPointerLeave={() => onHot(null)}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.headButton}
          data-head={server.id}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${server.name}, ${working ?? STATUS_LABEL[server.status]}, ${transport}${live ? `, ${on} of ${server.tools.length} tools on, ${formatTokens(tokens)} tokens` : ""}`}
          onClick={() => onToggleOpen(server.id)}
          onKeyDown={event => onHeadKey(event, server.id)}
          onFocus={() => onHot(server.id)}
          onBlur={() => onHot(null)}
        >
          <BrandMark brand={server.brand} />
          <span className={styles.headText}>
            <span className={styles.name}>{server.name}</span>
            <span className={styles.sub}>
              <StatusLabel status={server.status} working={working} reduced={reduced} />
              <span className={styles.subDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.transport}>{transport}</span>
            </span>
          </span>
          <Swap id={live ? "meta" : "spacer"} reduced={reduced} className={styles.metaSlot}>
            {live ? (
              <span className={styles.meta}>
                <span className={styles.toolCount}>
                  <Count value={on} />
                  {" of "}
                  {server.tools.length}
                  <span className={styles.wideOnly}>{"\u00a0tools"}</span>
                </span>
                <span className={styles.tokens}>
                  <TokenCount value={tokens} />
                  <span className={styles.srOnly}> tokens</span>
                </span>
              </span>
            ) : (
              <span className={styles.actionSpacer} data-action={server.status} aria-hidden="true" />
            )}
          </Swap>
          <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>

        {/* Sign in and Retry float above the row button, since a button cannot hold another button. */}
        <AnimatePresence initial={false}>
          {action ? (
            <motion.span key={action} className={styles.headAction} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: reduced ? still : fadeIn }} exit={{ opacity: 0, transition: reduced ? still : fadeOut }}>
              <Button size="sm" variant="secondary" className={styles.rowAction} onClick={() => (server.status === "needs-auth" ? onSignIn : onRetry)(server.id)} aria-label={`${action}: ${server.name}`}>
                {server.status === "needs-auth" ? <KeyRound size={15} strokeWidth={1.75} aria-hidden="true" /> : null}
                {action}
              </Button>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Only the open row renders its tools. */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="panel"
            id={panelId}
            role="region"
            aria-label={`${server.name} settings`}
            className={styles.panelClip}
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0, transition: still } : { height: 0, opacity: 0, transition: { height: settle, opacity: { duration: 0.12 } } }}
            transition={reduced ? still : { height: settle, opacity: fadeIn }}
          >
            <div className={styles.panel}>
              {live ? (
                <ToolList server={server} onToggleTool={onToggleTool} />
              ) : (
                <p className={styles.notice} data-tone={server.status === "error" ? "error" : "auth"}>
                  {server.status === "error" ? <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" /> : <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />}
                  <span>
                    {server.status === "error" ? (
                      <>
                        <span className={styles.noticeTitle}>Could not load tools.</span> {server.error ?? "The server did not answer."}
                      </>
                    ) : (
                      <>
                        <span className={styles.noticeTitle}>Signed out.</span> Sign in to {server.name} again to load its {server.tools.length || ""} tools.
                      </>
                    )}
                  </span>
                </p>
              )}

              <div className={styles.setting}>
                <span className={styles.settingLabel} id={`${uid}-permission`}>
                  Before a tool runs
                </span>
                <SegmentedControl label="Before a tool runs" options={PERMISSIONS} value={server.permission ?? "ask"} onValueChange={value => onPermission(server.id, value as McpPermission)} className={styles.segmented} />
              </div>

              <div className={styles.panelFoot}>
                {server.endpoint ? (
                  <code className={styles.endpoint} title={server.endpoint}>
                    {server.endpoint}
                  </code>
                ) : (
                  <span />
                )}
                <Button size="sm" variant="ghost" className={styles.remove} onClick={() => onRemove(server.id)} aria-label={`Remove ${server.name}`}>
                  <Trash size={15} strokeWidth={1.75} aria-hidden="true" />
                  Remove
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ToolList({ server, onToggleTool }: { server: McpServer; onToggleTool: (serverId: string, toolId: string, enabled: boolean) => void }) {
  const uid = useId();
  return (
    <ul className={styles.tools} aria-label={`${server.name} tools`}>
      {server.tools.map(tool => (
        <li key={tool.id} className={styles.tool} data-off={tool.enabled ? undefined : ""}>
          <ToolFields tool={tool} enabled={tool.enabled} switchId={`${uid}-${tool.id}`} onChange={enabled => onToggleTool(server.id, tool.id, enabled)} />
        </li>
      ))}
    </ul>
  );
}
