import { createEffect, createMemo, createSignal, createUniqueId, For, Index, on, onCleanup, Show, type JSX } from "solid-js"
import { DrawnCheck, RunIcon, StepIcon } from "./icons"
import {
  defaultAgentRunLabels,
  type AgentRunLabels,
  type AgentRunState,
  type AgentStep,
  type ChangedFile,
  type DiffLine,
  type ProposedChange,
  type RunResult,
} from "./types"
import "./agent-run.css"

export * from "./types"

/**
 * Solid port of the Arc Agent Run (replicate-arc-agent-run). Controlled only: the host passes the live run built
 * from real session events. A step waiting on the user shows the proposed change as a unified diff with Approve and
 * Reject; Reject asks what should change and sends that note back with the rejection.
 */
export interface AgentRunProps {
  task: string
  model?: { name: string; mark?: JSX.Element }
  run: AgentRunState
  labels?: Partial<AgentRunLabels>
  /** Approve the waiting change (a permission reply). */
  onApprove?: (change: ProposedChange) => void
  /** Reject the waiting change with a note for the agent. */
  onReject?: (change: ProposedChange, reason: string) => void
  /** Line diffs per changed path, so the result rows expand. */
  diffs?: Record<string, DiffLine[]>
  /** Stop a working run. */
  onStop?: () => void
  /** Hide a finished run. */
  onDismiss?: () => void
  /** Disable the decision buttons while a reply is in flight. */
  busy?: boolean
  class?: string
}

export function formatRunTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const count = (lines: DiffLine[], type: DiffLine["type"]) => lines.filter((line) => line.type === type).length

function DiffStat(props: { additions: number; deletions: number; blocks?: boolean; labels: AgentRunLabels }) {
  const green = () => Math.round((props.additions / Math.max(1, props.additions + props.deletions)) * 5)
  return (
    <span class="pc-ar-diffstat">
      <Show when={props.additions > 0}>
        <span class="pc-ar-additions">
          <span class="sr-only">{props.labels.added(props.additions)}</span>
          <span aria-hidden="true">+{props.additions}</span>
        </span>
      </Show>
      <Show when={props.deletions > 0}>
        <span class="pc-ar-deletions">
          <span class="sr-only">{props.labels.removed(props.deletions)}</span>
          <span aria-hidden="true">-{props.deletions}</span>
        </span>
      </Show>
      <Show when={props.blocks}>
        <span class="pc-ar-statBlocks" aria-hidden="true">
          <Index each={[0, 1, 2, 3, 4]}>{(i) => <i classList={{ added: i() < green(), removed: i() >= green() }} />}</Index>
        </span>
      </Show>
    </span>
  )
}

export function DiffCode(props: { lines: DiffLine[] }) {
  return (
    <div class="pc-ar-diffCode" dir="ltr">
      <For each={props.lines}>
        {(line) => (
          <div class={`pc-ar-codeLine pc-ar-code-${line.type}`}>
            <span class="pc-ar-lineNumber" aria-hidden="true">
              {line.new ?? line.old}
            </span>
            <span class="pc-ar-lineMarker" aria-hidden="true">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <code>{line.text || " "}</code>
          </div>
        )}
      </For>
    </div>
  )
}

function Approval(props: {
  change: ProposedChange
  labels: AgentRunLabels
  busy?: boolean
  onApprove?: (change: ProposedChange) => void
  onReject?: (change: ProposedChange, reason: string) => void
}) {
  const [file, setFile] = createSignal(0)
  const [rejecting, setRejecting] = createSignal(false)
  const [note, setNote] = createSignal("")
  const tabs: HTMLButtonElement[] = []
  let rejectButton: HTMLButtonElement | undefined
  let input: HTMLInputElement | undefined
  const id = createUniqueId()

  createEffect(() => {
    if (rejecting()) requestAnimationFrame(() => input?.focus())
  })

  const cancel = () => {
    setRejecting(false)
    requestAnimationFrame(() => rejectButton?.focus())
  }

  const navigate = (event: KeyboardEvent, index: number) => {
    const total = props.change.files.length
    let next = index
    if (event.key === "ArrowRight") next = (index + 1) % total
    else if (event.key === "ArrowLeft") next = (index - 1 + total) % total
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = total - 1
    else return
    event.preventDefault()
    setFile(next)
    tabs[next]?.focus()
  }

  return (
    <div class="pc-ar-proposal">
      <Show when={props.change.summary}>
        <p class="pc-ar-changeSummary">{props.change.summary}</p>
      </Show>
      <div class="pc-ar-diff">
        <div class="pc-ar-fileTabs" role="tablist" aria-label={props.labels.changedFiles}>
          <For each={props.change.files}>
            {(item, i) => (
              <button
                type="button"
                role="tab"
                id={`${id}-tab-${i()}`}
                aria-selected={i() === file()}
                aria-controls={`${id}-panel`}
                tabIndex={i() === file() ? 0 : -1}
                title={item.path}
                ref={(el) => (tabs[i()] = el)}
                class="pc-ar-fileTab"
                classList={{ "is-active": i() === file() }}
                onClick={() => setFile(i())}
                onKeyDown={(event) => navigate(event, i())}
              >
                <span class="pc-ar-filename">{item.path.split("/").pop()}</span>
                <DiffStat additions={count(item.lines, "add")} deletions={count(item.lines, "del")} labels={props.labels} />
              </button>
            )}
          </For>
        </div>
        <div class="pc-ar-diffPanels">
          <Show when={props.change.files[file()]} keyed>
            {(item) => (
              <div
                role="tabpanel"
                id={`${id}-panel`}
                aria-labelledby={`${id}-tab-${file()}`}
                tabIndex={0}
                class="pc-ar-diffPanel"
              >
                <DiffCode lines={item.lines} />
              </div>
            )}
          </Show>
        </div>
        <div class="pc-ar-approvalFooter">
          <Show
            when={rejecting()}
            fallback={
              <div class="pc-ar-approvalActions pc-ar-fadeIn">
                <p>{props.labels.nothingWritten}</p>
                <div class="pc-ar-decisionButtons">
                  <button
                    type="button"
                    class="pc-ar-button pc-ar-button-secondary"
                    ref={rejectButton}
                    disabled={props.busy}
                    onClick={() => setRejecting(true)}
                  >
                    {props.labels.reject}
                  </button>
                  <button
                    type="button"
                    class="pc-ar-button pc-ar-button-primary"
                    data-action="agent-run-approve"
                    disabled={props.busy}
                    onClick={() => props.onApprove?.(props.change)}
                  >
                    {props.labels.approve}
                  </button>
                </div>
              </div>
            }
          >
            <form
              class="pc-ar-rejectionForm pc-ar-fadeIn"
              onSubmit={(event) => {
                event.preventDefault()
                if (note().trim()) props.onReject?.(props.change, note().trim())
              }}
            >
              <label for={`${id}-note`}>{props.labels.whatShouldChange}</label>
              <input
                id={`${id}-note`}
                ref={input}
                value={note()}
                onInput={(event) => setNote(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return
                  event.preventDefault()
                  event.stopPropagation()
                  cancel()
                }}
                placeholder={props.labels.rejectPlaceholder}
                maxLength={500}
                autocomplete="off"
                required
              />
              <div class="pc-ar-rejectActions">
                <button type="button" class="pc-ar-button pc-ar-button-ghost" onClick={cancel}>
                  {props.labels.cancel}
                </button>
                <button
                  type="submit"
                  class="pc-ar-button pc-ar-button-primary"
                  data-action="agent-run-send-back"
                  disabled={!note().trim() || props.busy}
                >
                  {props.labels.sendBack}
                </button>
              </div>
            </form>
          </Show>
        </div>
      </div>
    </div>
  )
}

function StepRow(props: {
  step: AgentStep
  prefix: string
  now: number
  labels: AgentRunLabels
  busy?: boolean
  onApprove?: (change: ProposedChange) => void
  onReject?: (change: ProposedChange, reason: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const waiting = () => props.step.status === "waiting"
  const running = () => props.step.status === "running"
  const failed = () => props.step.status === "rejected" || props.step.status === "failed"
  const expandable = () => !waiting() && !!(props.step.io || props.step.text || props.step.change || props.step.reason)
  const verb = () =>
    waiting() && props.step.change ? props.labels.review : running() || waiting() ? props.step.verb : props.step.doneVerb
  const duration = () =>
    props.step.durationMs ?? (props.step.startedAt && running() ? props.now - props.step.startedAt : undefined)
  const details = () => `${props.prefix}-${props.step.id}-details`

  return (
    <li class="pc-ar-step pc-ar-stepIn" data-status={props.step.status}>
      <button
        type="button"
        class="pc-ar-stepHead"
        id={`${props.prefix}-${props.step.id}`}
        tabIndex={waiting() ? -1 : 0}
        aria-expanded={waiting() || (expandable() ? open() : undefined)}
        aria-controls={expandable() || waiting() ? details() : undefined}
        onClick={() => expandable() && setOpen((value) => !value)}
      >
        <span class="pc-ar-stepIcon">
          <StepIcon mark={props.step.mark} />
        </span>
        <span class="pc-ar-stepLabel" title={`${verb()}${props.step.target ? ` ${props.step.target}` : ""}`}>
          <span classList={{ "pc-ar-shimmer": running() }}>{verb()}</span>
          <Show when={props.step.target}>
            <span class="pc-ar-stepTarget">{props.step.target}</span>
          </Show>
        </span>
        <Show when={!waiting() && duration() !== undefined && (running() || (duration() ?? 0) >= 50)}>
          <span class="pc-ar-stepDuration">{((duration() ?? 0) / 1000).toFixed(1)}s</span>
        </Show>
        <Show when={!running() && !waiting()}>
          <Show when={failed()} fallback={<DrawnCheck />}>
            <RunIcon name="x" size={13} class="pc-ar-rejectedMark" />
          </Show>
        </Show>
        <Show when={expandable()}>
          <RunIcon name="chevronDown" size={14} class={`pc-ar-stepChevron ${open() ? "is-open" : ""}`} />
        </Show>
      </button>
      <Show when={waiting() && props.step.change}>
        {(change) => (
          <div id={details()}>
            <Approval
              change={change()}
              labels={props.labels}
              busy={props.busy}
              onApprove={props.onApprove}
              onReject={props.onReject}
            />
          </div>
        )}
      </Show>
      <Show when={open() && expandable()}>
        <div id={details()} class="pc-ar-stepDetailWrap pc-ar-grow">
          <div class="pc-ar-stepDetail" classList={{ "has-io": !!props.step.io }}>
            <Show when={props.step.reason}>
              <p class="pc-ar-sentBack">
                <span>{props.labels.yourFeedback}</span>
                <span>{props.step.reason}</span>
              </p>
            </Show>
            <Show when={props.step.io} fallback={<p>{props.step.text ?? props.step.change?.summary}</p>}>
              {(io) => (
                <>
                  <pre class="pc-ar-toolInput" dir="ltr">
                    <code>{io().input}</code>
                  </pre>
                  <Show when={io().output}>
                    <pre class="pc-ar-toolOutput" dir="ltr">
                      <code>{io().output}</code>
                    </pre>
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </li>
  )
}

function StreamingSummary(props: { text: string }) {
  const chunks = createMemo(() => props.text.match(/(?:\S+\s*){1,4}/g) ?? [props.text])
  return (
    <p class="pc-ar-resultSummary" aria-label={props.text}>
      <Index each={chunks()}>
        {(chunk, i) => (
          <span aria-hidden="true" class="pc-ar-streamChunk" style={{ "--chunk-delay": `${i * 34}ms` }}>
            {chunk()}
          </span>
        )}
      </Index>
    </p>
  )
}

function ResultFile(props: { file: ChangedFile; lines?: DiffLine[]; labels: AgentRunLabels }) {
  const [open, setOpen] = createSignal(false)
  const id = createUniqueId()
  return (
    <div class="pc-ar-resultFile">
      <button
        type="button"
        class="pc-ar-resultFileRow"
        disabled={!props.lines?.length}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={props.lines?.length ? open() : undefined}
        aria-controls={props.lines?.length ? id : undefined}
        title={props.file.path}
      >
        <RunIcon name="fileCode" />
        <span class="pc-ar-resultPath" dir="ltr">
          {props.file.path}
        </span>
        <DiffStat additions={props.file.additions} deletions={props.file.deletions} blocks labels={props.labels} />
      </button>
      <Show when={open() && props.lines}>
        {(lines) => (
          <div class="pc-ar-resultFileDiff" id={id} tabIndex={0} role="region" aria-label={props.labels.approvedChanges(props.file.path)}>
            <DiffCode lines={lines()} />
          </div>
        )}
      </Show>
    </div>
  )
}

function RunResultView(props: { result: RunResult; diffs?: Record<string, DiffLine[]>; labels: AgentRunLabels }) {
  const totals = createMemo(() =>
    props.result.files.reduce(
      (acc, file) => ({ additions: acc.additions + file.additions, deletions: acc.deletions + file.deletions }),
      { additions: 0, deletions: 0 },
    ),
  )
  return (
    <div class="pc-ar-result pc-ar-grow">
      <div class="pc-ar-resultInner">
        <Show when={props.result.summary}>
          <StreamingSummary text={props.result.summary} />
        </Show>
        <Show when={props.result.files.length > 0}>
          <div class="pc-ar-filesHeading">
            <span>{props.labels.filesChanged(props.result.files.length)}</span>
            <DiffStat additions={totals().additions} deletions={totals().deletions} labels={props.labels} />
          </div>
          <div class="pc-ar-resultFiles">
            <For each={props.result.files}>
              {(file) => <ResultFile file={file} lines={props.diffs?.[file.path]} labels={props.labels} />}
            </For>
          </div>
        </Show>
        <Show when={props.result.checks.length > 0}>
          <div class="pc-ar-resultChecks">
            <For each={props.result.checks}>
              {(check) => (
                <span title={check.label}>
                  <RunIcon
                    name={check.passed ? "circleCheck" : "circleStop"}
                    size={15}
                    class={check.passed ? "pc-ar-success" : "pc-ar-rejectedMark"}
                  />
                  <span class="pc-ar-checkLabel" dir="ltr">
                    {check.label}
                  </span>
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

export function AgentRun(props: AgentRunProps) {
  const labels = () => ({ ...defaultAgentRunLabels, ...props.labels })
  const prefix = createUniqueId()
  const [now, setNow] = createSignal(Date.now())
  const [showSteps, setShowSteps] = createSignal(false)
  const done = () => props.run.status === "done"
  const stopped = () => props.run.status === "stopped"
  const live = () => props.run.status === "working" || props.run.status === "waiting"

  createEffect(() => {
    if (!live()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    onCleanup(() => clearInterval(timer))
  })

  // A finished run folds its steps behind the summary, as in Arc.
  createEffect(on(done, (value) => value && setShowSteps(false)))

  const elapsed = () => (props.run.endedAt ?? now()) - props.run.startedAt
  const statusText = () =>
    stopped()
      ? labels().stopped
      : done()
        ? labels().done
        : props.run.status === "waiting"
          ? labels().waiting
          : labels().working
  const last = () => props.run.steps[props.run.steps.length - 1]
  const announcement = () =>
    stopped()
      ? labels().stoppedTitle
      : done()
        ? `${labels().done}. ${labels().stepsFolded(props.run.steps.length, Math.round(elapsed() / 1000))}`
        : props.run.status === "waiting"
          ? labels().waiting
          : last()
            ? `${last()!.verb}${last()!.target ? ` ${last()!.target}` : ""}`
            : ""

  return (
    <section
      class={`pc-ar ${props.class ?? ""}`}
      aria-labelledby={`${prefix}-task`}
      data-status={props.run.status}
      data-component="panacode-agent-run"
    >
      <header class="pc-ar-header">
        <div class="pc-ar-titleRow">
          <h2 id={`${prefix}-task`} title={props.task}>
            {props.task}
          </h2>
          <Show when={live() && props.onStop}>
            <button type="button" class="pc-ar-iconButton" aria-label={labels().stop} title={labels().stop} onClick={() => props.onStop?.()}>
              <RunIcon name="circleStop" size={16} stroke={1.6} />
            </button>
          </Show>
          <Show when={!live() && props.onDismiss}>
            <button
              type="button"
              class="pc-ar-iconButton"
              data-action="agent-run-dismiss"
              aria-label={labels().dismiss}
              title={labels().dismiss}
              onClick={() => props.onDismiss?.()}
            >
              <RunIcon name="x" size={16} stroke={1.6} />
            </button>
          </Show>
        </div>
        <div class="pc-ar-metaRow">
          <Show when={props.model}>
            {(model) => (
              <span class="pc-ar-model">
                <Show when={model().mark}>
                  <span aria-hidden="true">{model().mark}</span>
                </Show>
                {model().name}
              </span>
            )}
          </Show>
          <span class={`pc-ar-status pc-ar-status-${props.run.status}`}>
            <Show
              when={stopped()}
              fallback={
                <Show
                  when={done()}
                  fallback={
                    <Show
                      when={props.run.status === "waiting"}
                      fallback={<RunIcon name="loader" size={14} class="pc-ar-spinner" />}
                    >
                      <RunIcon name="hand" size={14} />
                    </Show>
                  }
                >
                  <RunIcon name="circleCheck" size={14} />
                </Show>
              }
            >
              <RunIcon name="circleStop" size={14} />
            </Show>
            <Show when={statusText()} keyed>
              {(text) => <span class="pc-ar-statusText" classList={{ "pc-ar-shimmer": props.run.status === "working" }}>{text}</span>}
            </Show>
          </span>
          <span class="pc-ar-elapsed" aria-label={labels().secondsOfWork(Math.floor(elapsed() / 1000))}>
            {formatRunTime(elapsed())}
          </span>
        </div>
      </header>
      <div class="pc-ar-stepsArea">
        <Show when={(done() || stopped()) && props.run.steps.length > 0}>
          <button
            type="button"
            class="pc-ar-foldedSteps"
            aria-expanded={showSteps()}
            aria-controls={`${prefix}-steps`}
            onClick={() => setShowSteps((value) => !value)}
          >
            <RunIcon name="listChecks" />
            <span>{labels().stepsFolded(props.run.steps.length, Math.round(elapsed() / 1000))}</span>
            <RunIcon name="chevronDown" size={14} class={showSteps() ? "is-open" : ""} />
          </button>
        </Show>
        <Show when={live() || showSteps()}>
          <div id={`${prefix}-steps`} class="pc-ar-listWrap">
            <ol class="pc-ar-steps" aria-label={labels().steps}>
              <For each={props.run.steps}>
                {(step) => (
                  <StepRow
                    step={step}
                    prefix={prefix}
                    now={now()}
                    labels={labels()}
                    busy={props.busy}
                    onApprove={props.onApprove}
                    onReject={props.onReject}
                  />
                )}
              </For>
            </ol>
          </div>
        </Show>
        <Show when={live() && props.run.steps.length === 0}>
          <p class="pc-ar-pendingEvent">{labels().waitingFirst}</p>
        </Show>
      </div>
      <Show when={stopped()}>
        <div class="pc-ar-stopped">
          <RunIcon name="circleStop" size={18} />
          <div>
            <h3>{labels().stoppedTitle}</h3>
            <p>{labels().stoppedBody}</p>
          </div>
        </div>
      </Show>
      <Show when={done() && props.run.result}>
        {(result) => <RunResultView result={result()} diffs={props.diffs} labels={labels()} />}
      </Show>
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {announcement()}
      </p>
    </section>
  )
}

export { DiffStat }
