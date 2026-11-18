"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, type Variants } from "motion/react";
import { ArrowLeft, ArrowLeftRight, Check, ChevronRight, CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Avatar } from "../../avatar/avatar";
import { Button } from "../../button/button";
import { Input } from "../../input/input";
import { SearchField } from "../../search-field/search-field";
import { TextShimmer } from "../../text-shimmer/text-shimmer";
import { describeScopes, describeUrl, parseServerUrl, plural, startsEnabled, uniqueTools } from "./format";
import { BrandMark, Count, Swap, TokenCount, ToolFields, easeEnter } from "./parts";
import { urlServerTools } from "./sample-data";
import type { McpAccount, McpBrand, McpConnectRequest, McpDirectoryEntry, McpPermission, McpReportedTool, McpServer, McpTransport } from "./types";
import styles from "./mcp-servers.module.css";

/** Add server opens the directory. Sign in on a row reopens the same sheet at the authorize step. */
export type SheetMode = { kind: "add" } | { kind: "reconnect"; server: McpServer };

export type ConnectKind = McpConnectRequest["kind"];

/** The server the flow is connecting, whichever way it was chosen. */
interface Target {
  kind: ConnectKind;
  id: string;
  name: string;
  brand?: McpBrand;
  transport: McpTransport;
  endpoint?: string;
  auth: "oauth" | "none";
  scopes: string[];
  /** What is already known about its tools: the fallback when discovery reports nothing. */
  tools: McpReportedTool[];
  permission?: McpPermission;
}

type Step = { name: "directory" } | { name: "authorize"; target: Target } | { name: "discover"; target: Target };

type Phase = "working" | "done" | "error";

export interface ConnectSheetProps {
  mode: SheetMode;
  directory: McpDirectoryEntry[];
  /** Ids already in the list. Their directory entries read Added. */
  connectedIds: string[];
  clientName: string;
  clientMark: ReactNode;
  account: McpAccount;
  reduced: boolean;
  /** True while no onConnect is wired. The authorize screen then says plainly that no account is contacted. */
  simulated: boolean;
  connect: (request: McpConnectRequest, known: McpReportedTool[]) => Promise<McpReportedTool[]>;
  onClose: () => void;
  onDone: (server: McpServer, kind: ConnectKind) => void;
  announce: (message: string) => void;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function reconnectTarget(server: McpServer): Target {
  return {
    kind: "reconnect",
    id: server.id,
    name: server.name,
    brand: server.brand,
    transport: server.transport,
    endpoint: server.endpoint,
    auth: "oauth",
    scopes: server.scopes ?? describeScopes(server.tools, server.name),
    tools: server.tools,
    permission: server.permission,
  };
}

function directoryTarget(entry: McpDirectoryEntry): Target {
  return {
    kind: "directory",
    id: entry.id,
    name: entry.name,
    brand: entry.brand,
    transport: entry.transport,
    endpoint: entry.endpoint,
    auth: entry.auth,
    scopes: entry.scopes ?? describeScopes(entry.tools, entry.name),
    tools: entry.tools,
  };
}

/**
 * The sheet that rises inside the card. One dialog carries the whole flow: pick a server from the directory or paste
 * a URL, authorize it, then watch its tools arrive and choose which ones to load.
 */
export function ConnectSheet({ mode, directory, connectedIds, clientName, clientMark, account, reduced, simulated, connect, onClose, onDone, announce }: ConnectSheetProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const urlHintId = `${uid}-url`;
  const present = useIsPresent();

  const [step, setStep] = useState<Step>(() => (mode.kind === "reconnect" ? { name: "authorize", target: reconnectTarget(mode.server) } : { name: "directory" }));
  const [direction, setDirection] = useState<1 | -1>(1);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string>();
  const [authorizing, setAuthorizing] = useState(false);
  const [phase, setPhase] = useState<Phase>("working");
  const [found, setFound] = useState<McpReportedTool[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const authorizeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // A run ticket. Anything still on its way from a run that was abandoned (Back, Close, Try again) is ignored.
  const ticket = useRef(0);
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      ticket.current += 1;
      pending.forEach(id => window.clearTimeout(id));
      pending.clear();
    };
  }, []);

  // Closing abandons the run at once, before the sheet has finished leaving.
  useEffect(() => {
    if (!present) ticket.current += 1;
  }, [present]);

  const later = useCallback((run: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }, []);

  const go = useCallback((next: Step, towards: 1 | -1) => {
    setDirection(towards);
    setStep(next);
  }, []);

  const discover = useCallback(
    (target: Target) => {
      const run = ++ticket.current;
      go({ name: "discover", target }, 1);
      setAuthorizing(false);
      setPhase("working");
      setFound([]);
      setEnabled({});
      setFailure(null);
      announce(`Discovering tools on ${target.name}.`);

      connect({ kind: target.kind, serverId: target.id, name: target.name, transport: target.transport, endpoint: target.endpoint }, target.tools)
        .then(reported => {
          if (ticket.current !== run) return;
          const tools = uniqueTools(reported);
          const known = new Map(target.tools.map(tool => [tool.id, tool]));
          // Tools arrive one by one, then the heading settles.
          tools.forEach((tool, index) => {
            later(
              () => {
                if (ticket.current !== run) return;
                setFound(list => [...list, tool]);
                setEnabled(map => ({ ...map, [tool.id]: startsEnabled(tool, known) }));
              },
              40 + 95 * index,
            );
          });
          later(
            () => {
              if (ticket.current !== run) return;
              setPhase("done");
              announce(tools.length ? `Found ${tools.length} ${plural(tools.length, "tool", "tools")} on ${target.name}. Reads are on, writes are off.` : `${target.name} reported no tools.`);
            },
            120 + 95 * tools.length,
          );
        })
        .catch((cause: unknown) => {
          if (ticket.current !== run) return;
          const reason = cause instanceof Error && cause.message ? cause.message : `${target.name} did not answer.`;
          setPhase("error");
          setFailure(reason);
          announce(`Discovery failed. ${reason}`);
        });
    },
    [announce, connect, go, later],
  );

  const choose = (entry: McpDirectoryEntry) => {
    const target = directoryTarget(entry);
    if (target.auth === "oauth") go({ name: "authorize", target }, 1);
    else discover(target);
  };

  const backToDirectory = () => {
    ticket.current += 1;
    setAuthorizing(false);
    go({ name: "directory" }, -1);
  };

  const authorize = (target: Target) => {
    if (authorizing) return;
    // Wired to a client: hand over inside the press itself, so a consent window opened in onConnect is not blocked.
    if (!simulated) {
      discover(target);
      return;
    }
    const run = ++ticket.current;
    setAuthorizing(true);
    announce(`Authorizing ${target.name}. Simulated, no account is contacted.`);
    later(
      () => {
        if (ticket.current !== run) return;
        discover(target);
      },
      reduced ? 200 : 620,
    );
  };

  const submitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseServerUrl(url);
    if (!parsed) {
      setUrlError("Enter a server URL, like https://mcp.example.com/mcp");
      return;
    }
    setUrlError(undefined);
    const { id, name, endpoint } = describeUrl(parsed);
    // Nothing is known about a pasted URL. The demo assumes two tools; a real client reports its own.
    discover({ kind: "url", id, name, transport: "remote", endpoint, auth: "none", scopes: [], tools: simulated ? urlServerTools : [] });
  };

  const finish = () => {
    if (step.name !== "discover" || phase !== "done") return;
    const { target } = step;
    onDone(
      {
        id: target.id,
        name: target.name,
        brand: target.brand,
        transport: target.transport,
        endpoint: target.endpoint,
        status: "connected",
        permission: target.permission ?? "ask",
        scopes: target.auth === "oauth" ? target.scopes : undefined,
        tools: found.map(tool => ({ id: tool.id, name: tool.name, access: tool.access, tokens: tool.tokens, enabled: !!enabled[tool.id] })),
      },
      target.kind,
    );
  };

  const stepKey = step.name === "directory" ? "directory" : `${step.name}-${step.target.id}`;

  // Focus follows the flow: the search field, then Authorize, then the step heading.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next = step.name === "directory" ? searchRef.current : step.name === "authorize" ? authorizeRef.current : headingRef.current;
      next?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of step moves focus.
  }, [stepKey]);

  // Once the tools are in, focus moves on from the heading to the button that finishes the flow.
  useEffect(() => {
    if (phase === "done" && step.name === "discover" && document.activeElement === headingRef.current) confirmRef.current?.focus({ preventScroll: true });
  }, [phase, step.name]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? directory.filter(entry => `${entry.name} ${entry.description}`.toLowerCase().includes(needle)) : directory;
  }, [directory, query]);

  const heading = step.name === "directory" ? "Add a server" : step.name === "authorize" ? `Sign in to ${step.target.name}` : step.target.name;
  const canGoBack = step.name !== "directory" && step.target.kind !== "reconnect" && step.target.kind !== "retry";
  const reconnecting = mode.kind === "reconnect";
  const turnedOn = found.filter(tool => enabled[tool.id]);
  const turnedOnTokens = turnedOn.reduce((sum, tool) => sum + tool.tokens, 0);

  const onSheetKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !sheetRef.current) return;
    const stops = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(node => node.offsetParent !== null && !node.closest("[data-leaving]"));
    if (!stops.length) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Arrow keys walk from the search field into the directory, between entries, and back up to the field.
  const onDirectoryKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const entries = [...(sheetRef.current?.querySelectorAll<HTMLElement>("[data-entry]:not([disabled])") ?? [])];
    if (!entries.length) return;
    const at = entries.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    if (event.key === "ArrowDown") entries[at < 0 ? 0 : Math.min(entries.length - 1, at + 1)]?.focus();
    else if (at <= 0) searchRef.current?.focus();
    else entries[at - 1]?.focus();
  };

  return (
    <motion.div
      ref={sheetRef}
      className={styles.sheet}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      // Focusable from script and by pointer, so a click on the sheet's own surface keeps Escape and Tab working.
      tabIndex={-1}
      onKeyDown={onSheetKeyDown}
      initial={reduced ? { opacity: 0 } : { y: "100%" }}
      animate={reduced ? { opacity: 1 } : { y: 0 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { y: "100%", transition: { type: "spring", visualDuration: 0.26, bounce: 0 } }}
      transition={reduced ? { duration: 0.12 } : { type: "spring", visualDuration: 0.34, bounce: 0 }}
    >
      <div className={styles.sheetHead}>
        <span className={styles.sheetSide}>
          <AnimatePresence initial={false}>
            {canGoBack ? (
              <motion.span key="back" className={styles.sheetSideItem} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.14 }}>
                <Button variant="ghost" size="sm" className={styles.iconButton} onClick={backToDirectory} aria-label="Back to the directory">
                  <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </span>
        <h3 id={titleId} className={styles.sheetTitle}>
          <Swap id={heading} reduced={reduced}>
            {heading}
          </Swap>
        </h3>
        <span className={styles.sheetSide} data-end="">
          <Button variant="ghost" size="sm" className={styles.iconButton} onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </span>
      </div>

      <div className={styles.sheetBody}>
        <AnimatePresence initial={false} custom={direction}>
          <StepFrame key={stepKey} direction={direction} reduced={reduced}>
            {step.name === "directory" ? (
              <>
                <div className={styles.stepScroll} onKeyDown={onDirectoryKeyDown}>
                  <div className={styles.searchWrap}>
                    <SearchField ref={searchRef} label="Search servers" placeholder="Search servers" value={query} onValueChange={setQuery} autoComplete="off" />
                  </div>
                  {matches.length ? (
                    <ul className={styles.directory} aria-label="Servers">
                      {matches.map(entry => {
                        const added = connectedIds.includes(entry.id);
                        return (
                          <li key={entry.id}>
                            <button type="button" data-entry="" className={styles.entry} disabled={added} onClick={() => choose(entry)} aria-label={`${entry.name}, ${entry.description}${added ? ", already added" : ""}`}>
                              <BrandMark brand={entry.brand} className={styles.entryMark} />
                              <span className={styles.entryText}>
                                <span className={styles.entryName}>{entry.name}</span>
                                <span className={styles.entryDesc}>{entry.description}</span>
                              </span>
                              <span className={styles.entryMeta}>
                                {added ? (
                                  <>
                                    <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                                    Added
                                  </>
                                ) : (
                                  <>
                                    {entry.transport === "local" ? "Local" : "Remote"}
                                    <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                                  </>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className={styles.noResults} role="status">
                      <p className={styles.noResultsTitle}>No servers match “{query.trim()}”</p>
                      <p>Paste the server&apos;s URL below to connect it directly.</p>
                    </div>
                  )}
                </div>
                <form className={styles.urlForm} onSubmit={submitUrl} noValidate>
                  <p className={styles.urlTitle} id={urlHintId}>
                    Or connect by URL
                  </p>
                  <div className={styles.urlRow}>
                    <Input
                      label="Server URL"
                      placeholder="https://mcp.example.com/mcp"
                      value={url}
                      onChange={event => {
                        setUrl(event.target.value);
                        if (urlError) setUrlError(undefined);
                      }}
                      error={urlError}
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby={urlHintId}
                    />
                    <Button type="submit" variant="secondary">
                      Connect
                    </Button>
                  </div>
                </form>
              </>
            ) : null}

            {step.name === "authorize" ? (
              <>
                <div className={styles.stepScroll}>
                  <div className={styles.auth}>
                    {simulated ? (
                      <p className={styles.simTag}>
                        <Info size={14} strokeWidth={1.75} aria-hidden="true" />
                        Simulated sign in
                      </p>
                    ) : null}
                    <div className={styles.handshake} aria-hidden="true">
                      <BrandMark brand={step.target.brand} className={styles.handshakeMark} />
                      <span className={styles.handshakeLine}>
                        <ArrowLeftRight size={14} strokeWidth={1.75} />
                      </span>
                      <span className={styles.handshakeClient}>{clientMark}</span>
                    </div>
                    <p className={styles.authTitle}>
                      {clientName} wants to use your {step.target.name} account
                    </p>
                    <div className={styles.account}>
                      <Avatar name={account.name} src={account.avatar} size="sm" className={styles.accountAvatar} aria-hidden="true" />
                      <span className={styles.accountName}>{account.name}</span>
                      <span className={styles.accountEmail}>{account.email}</span>
                    </div>
                    {step.target.scopes.length ? (
                      <div className={styles.scopes}>
                        <p className={styles.scopesTitle}>This lets the agent</p>
                        <ul>
                          {step.target.scopes.map(scope => (
                            <li key={scope}>
                              <Check size={15} strokeWidth={1.75} aria-hidden="true" />
                              {scope}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className={styles.stepFoot}>
                  {simulated ? <p className={styles.footNote}>No {step.target.name} account is contacted.</p> : null}
                  <div className={styles.footActions}>
                    <Button variant="ghost" onClick={reconnecting ? onClose : backToDirectory}>
                      Cancel
                    </Button>
                    <Button ref={authorizeRef} className={styles.accentButton} loading={authorizing} onClick={() => authorize(step.target)}>
                      Authorize
                    </Button>
                  </div>
                </div>
              </>
            ) : null}

            {step.name === "discover" ? (
              <>
                <div className={styles.stepScroll}>
                  <div className={styles.discoverHead}>
                    <BrandMark brand={step.target.brand} className={styles.discoverMark} />
                    <div className={styles.discoverText}>
                      <h4 ref={headingRef} tabIndex={-1} className={styles.discoverTitle}>
                        <Swap id={phase} reduced={reduced}>
                          {phase === "working" ? (
                            <TextShimmer>Discovering tools</TextShimmer>
                          ) : phase === "done" ? (
                            <span className={styles.phaseDone}>
                              <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
                              Found {found.length} {plural(found.length, "tool", "tools")}
                            </span>
                          ) : (
                            <span className={styles.phaseError}>
                              <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                              Discovery failed
                            </span>
                          )}
                        </Swap>
                      </h4>
                      <p className={styles.discoverSub}>{step.target.endpoint ?? (step.target.transport === "local" ? "Local server" : "Remote server")}</p>
                    </div>
                  </div>

                  {phase === "error" ? (
                    <div className={styles.discoverError} role="alert">
                      <p>{failure}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          // This button is about to leave, so focus moves to the step heading instead of the page body.
                          headingRef.current?.focus({ preventScroll: true });
                          discover(step.target);
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  ) : (
                    <ul className={styles.found} aria-label={`${step.target.name} tools`} aria-busy={phase === "working"}>
                      <AnimatePresence initial={false}>
                        {found.map(tool => (
                          <motion.li
                            key={tool.id}
                            className={styles.tool}
                            data-off={enabled[tool.id] ? undefined : ""}
                            initial={{ opacity: 0, y: reduced ? 0 : 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: reduced ? 0 : 0.18, ease: easeEnter }}
                          >
                            <ToolFields tool={tool} enabled={!!enabled[tool.id]} switchId={`${uid}-found-${tool.id}`} onChange={next => setEnabled(map => ({ ...map, [tool.id]: next }))} />
                          </motion.li>
                        ))}
                      </AnimatePresence>
                      {phase === "working" && !reduced ? (
                        <li className={styles.foundPending} aria-hidden="true">
                          <span />
                          <span />
                        </li>
                      ) : null}
                    </ul>
                  )}
                </div>
                <div className={styles.stepFoot}>
                  <p className={styles.footNote}>
                    {phase === "error" ? (
                      "Nothing was added."
                    ) : (
                      <>
                        <span className={styles.footValue}>
                          <Count value={turnedOn.length} />
                        </span>
                        {"\u00a0on"}
                        <span aria-hidden="true">{"\u00a0\u00b7\u00a0"}</span>
                        <span className={styles.footValue}>
                          <TokenCount value={turnedOnTokens} />
                        </span>
                        {"\u00a0tokens"}
                      </>
                    )}
                  </p>
                  <div className={styles.footActions}>
                    <Button ref={confirmRef} className={styles.accentButton} disabled={phase !== "done"} onClick={finish}>
                      {step.target.kind === "reconnect" ? "Done" : "Add server"}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </StepFrame>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

interface StepFrameProps {
  /** 1 moves forward through the flow, -1 back to the directory. */
  direction: 1 | -1;
  reduced: boolean;
  children: ReactNode;
}

/** One step of the sheet. Steps cross fade with an 18px shift in the direction of the flow. */
function StepFrame({ direction, reduced, children }: StepFrameProps) {
  const present = useIsPresent();
  const variants = useMemo<Variants>(
    () => ({
      enter: (towards: number) => ({ opacity: 0, x: reduced ? 0 : 18 * towards }),
      center: { opacity: 1, x: 0, transition: { duration: reduced ? 0 : 0.22, ease: easeEnter } },
      exit: (towards: number) => ({ opacity: 0, x: reduced ? 0 : -18 * towards, transition: { duration: reduced ? 0 : 0.12, ease: easeEnter } }),
    }),
    [reduced],
  );
  // A step on its way out takes no focus and no clicks.
  return (
    <motion.div className={styles.step} data-leaving={present ? undefined : ""} inert={!present} custom={direction} variants={variants} initial="enter" animate="center" exit="exit">
      {children}
    </motion.div>
  );
}
