import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowUpRight, ChevronDown, CircleCheck, CircleStop, FileCode2, Hand, ListChecks, LoaderCircle, Play, RotateCcw, X } from 'lucide-react';
import { ClaudeMark, DrawnCheck, GithubMark, StepIcon } from './marks';
import { sampleScript } from './sample-script';
import { useSimulatedRun } from './use-simulated-run';
import type { AgentRunProps, AgentStep, ChangedFile, DiffLine, ProposedChange, PullRequest, RunResult } from './types';
import './agent-run.css';

export type * from './types';
export { sampleScript, sampleChange } from './sample-script';
export { useSimulatedRun } from './use-simulated-run';

const spring = { type: 'spring' as const, stiffness: 340, damping: 38, mass: 0.8 };
const defaultModel = { name: 'Claude Sonnet 5.5', mark: <ClaudeMark /> };

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function DiffStat({ additions, deletions, blocks = false }: { additions: number; deletions: number; blocks?: boolean }) {
  const greenBlocks = Math.round(additions / Math.max(1, additions + deletions) * 5);
  return (
    <span className="ar-diffstat">
      {additions > 0 && <span className="ar-additions"><span className="sr-only">{additions} added</span><span aria-hidden="true">+{additions}</span></span>}
      {deletions > 0 && <span className="ar-deletions"><span className="sr-only">{deletions} removed</span><span aria-hidden="true">-{deletions}</span></span>}
      {blocks && <span className="ar-stat-blocks" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < greenBlocks ? 'added' : 'removed'} />)}</span>}
    </span>
  );
}

function DiffCode({ lines }: { lines: DiffLine[] }) {
  return <div className="ar-diff-code">{lines.map((line, i) => (
    <div className={`ar-code-line ar-code-${line.type}`} key={i}>
      <span className="ar-line-number" aria-hidden="true">{line.new ?? line.old}</span>
      <span className="ar-line-marker" aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
      <code><span className="sr-only">{line.type === 'add' ? 'Added: ' : line.type === 'del' ? 'Removed: ' : ''}</span>{line.text || ' '}</code>
    </div>
  ))}</div>;
}

function Approval({ change, onApprove, onReject }: { change: ProposedChange; onApprove: (change: ProposedChange) => void; onReject: (change: ProposedChange, reason: string) => void }) {
  const [file, setFile] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const id = useId();

  useEffect(() => { if (rejecting) input.current?.focus(); }, [rejecting]);

  const cancel = () => {
    input.current?.blur();
    setRejecting(false);
    requestAnimationFrame(() => rejectButton.current?.focus());
  };

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % change.files.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + change.files.length) % change.files.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = change.files.length - 1;
    else return;
    event.preventDefault();
    setFile(next);
    tabs.current[next]?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (note.trim()) onReject(change, note.trim());
  };

  return (
    <div className="ar-proposal">
      <p className="ar-change-summary">{change.summary}</p>
      <div className="ar-diff">
        <div className="ar-file-tabs" role="tablist" aria-label="Changed files">
          {change.files.map((item, i) => (
            <button
              type="button" role="tab" key={item.path} id={`${id}-tab-${i}`} aria-selected={i === file}
              aria-controls={`${id}-panel-${i}`} tabIndex={i === file ? 0 : -1} title={item.path}
              aria-label={`${item.path}, ${item.lines.filter(line => line.type === 'add').length} added, ${item.lines.filter(line => line.type === 'del').length} removed`}
              ref={el => { tabs.current[i] = el; }} onClick={() => setFile(i)} onKeyDown={event => navigateTabs(event, i)}
              className={`ar-file-tab ${i === file ? 'is-active' : ''}`}
            >
              <span className="ar-filename">{item.path.split('/').pop()}</span>
              <DiffStat additions={item.lines.filter(line => line.type === 'add').length} deletions={item.lines.filter(line => line.type === 'del').length} />
            </button>
          ))}
        </div>
        <div className="ar-diff-panels">
          {change.files.map((item, i) => (
            <motion.div
              key={item.path} role="tabpanel" id={`${id}-panel-${i}`} aria-label={item.path} aria-labelledby={`${id}-tab-${i}`}
              inert={i !== file} tabIndex={i === file ? 0 : -1} aria-hidden={i !== file}
              className="ar-diff-panel" data-active={i === file}
              initial={false} animate={{ opacity: i === file ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.16 }}
            >
              <DiffCode lines={item.lines} />
            </motion.div>
          ))}
        </div>
        <motion.div className="ar-approval-footer" layout="size" transition={reduced ? { duration: 0 } : spring}>
          <AnimatePresence initial={false} mode="popLayout">
            {rejecting ? (
              <motion.form key="note" className="ar-rejection-form" onSubmit={submit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.1 }}>
                <label htmlFor={`${id}-note`}>What should change?</label>
                <input
                  id={`${id}-note`} ref={input} value={note} onChange={event => setNote(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } }}
                  placeholder="For example, make the limit configurable" maxLength={500} autoComplete="off" autoFocus required
                />
                <div className="ar-reject-actions">
                  <button type="button" className="ar-button ar-button-ghost" onClick={cancel}>Cancel</button>
                  <button type="submit" className="ar-button ar-button-primary" disabled={!note.trim()}>Send back</button>
                </div>
              </motion.form>
            ) : (
              <motion.div key="actions" className="ar-approval-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.1 }}>
                <p>Nothing is written until you approve.</p>
                <div className="ar-decision-buttons">
                  <button type="button" className="ar-button ar-button-secondary" ref={rejectButton} onClick={() => setRejecting(true)}>Reject</button>
                  <button type="button" className="ar-button ar-button-primary" onClick={() => onApprove(change)}>Approve</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

const StepRow = memo(function StepRow({ step, prefix, onApprove, onReject }: { step: AgentStep; prefix: string; onApprove: (change: ProposedChange) => void; onReject: (change: ProposedChange, reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const waiting = step.status === 'waiting';
  const running = step.status === 'running';
  const rejected = step.status === 'rejected';
  const expandable = !waiting && !!(step.io || step.text || step.change || step.reason);
  const verb = waiting ? 'Review' : running ? step.verb : step.doneVerb;
  const target = running ? step.target : (step.doneTarget ?? step.target);
  const detailsId = `${prefix}-${step.id}-details`;

  return (
    <motion.li className="ar-step" data-status={step.status}
      initial={{ height: reduced ? 'auto' : 0, opacity: reduced ? 1 : 0 }} animate={{ height: 'auto', opacity: 1 }}
      transition={reduced ? { duration: 0 } : spring}
    >
      <button
        type="button" className="ar-step-head" id={`${prefix}-${step.id}`} tabIndex={waiting ? -1 : 0}
        aria-expanded={waiting || (expandable ? open : undefined)} aria-controls={expandable || waiting ? detailsId : undefined}
        onClick={() => { if (expandable) setOpen(value => !value); }}
      >
        <span className="ar-step-icon">{step.icon ?? <StepIcon mark={step.mark} />}</span>
        <span className="ar-step-label" title={`${verb}${target ? ` ${target}` : ''}`}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span className={running ? 'ar-shimmer' : ''} key={verb} initial={{ opacity: 0, y: reduced ? 0 : 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.16 }}>{verb}</motion.span>
          </AnimatePresence>
          {target && <span className="ar-step-target">{target}</span>}
        </span>
        {running && step.progress && <span className="ar-step-progress" aria-label={`${step.progress.value} of ${step.progress.total}`}>{step.progress.value}<span>/</span>{step.progress.total}</span>}
        {!waiting && <span className="ar-step-duration">{((step.elapsedMs ?? step.durationMs ?? 0) / 1000).toFixed(1)}s</span>}
        {!running && !waiting && (rejected ? <X size={13} className="ar-rejected-mark" aria-hidden="true" /> : <DrawnCheck />)}
        {expandable && <ChevronDown size={14} className={`ar-step-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />}
      </button>
      {waiting && step.change && <div id={detailsId}><Approval change={step.change} onApprove={onApprove} onReject={onReject} /></div>}
      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div id={detailsId} initial={{ height: reduced ? 'auto' : 0, opacity: reduced ? 1 : 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : spring} className="ar-step-detail-wrap">
            <div className={`ar-step-detail ${step.io ? 'has-io' : ''}`}>
              {step.reason && <p className="ar-sent-back"><span>Your feedback</span><span>{step.reason}</span></p>}
              {step.io ? <><pre className="ar-tool-input"><code>{step.io.input}</code></pre><pre className="ar-tool-output"><code>{step.io.output}</code></pre></> : <p>{step.text ?? step.change?.summary}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
});

function StreamingSummary({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const chunks = useMemo(() => text.match(/(?:\S+\s*){1,4}/g) ?? [text], [text]);
  return <p className="ar-result-summary" aria-label={text}>{chunks.map((chunk, i) => <span key={i} aria-hidden="true" className={reduced ? '' : 'ar-stream-chunk'} style={{ '--chunk-delay': `${i * 34}ms` } as CSSProperties}>{chunk}</span>)}</p>;
}

function ResultFile({ file, change }: { file: ChangedFile; change?: ProposedChange }) {
  const [open, setOpen] = useState(false);
  const match = change?.files.find(item => item.path === file.path);
  const id = useId();
  return <div className="ar-result-file">
    <button type="button" className="ar-result-file-row" disabled={!match} onClick={() => setOpen(value => !value)} aria-expanded={match ? open : undefined} aria-controls={match ? id : undefined} title={file.path}>
      <FileCode2 size={16} aria-hidden="true" /><span className="ar-result-path">{file.path}</span><DiffStat additions={file.additions} deletions={file.deletions} blocks />
    </button>
    {open && match && <div className="ar-result-file-diff" id={id} tabIndex={0} role="region" aria-label={`Approved changes to ${file.path}`}><DiffCode lines={match.lines} /></div>}
  </div>;
}

function RunResultView({ result, change, onOpenPullRequest }: { result: RunResult; change?: ProposedChange; onOpenPullRequest?: AgentRunProps['onOpenPullRequest'] }) {
  const [prStatus, setPrStatus] = useState<'idle' | 'opening' | 'opened'>('idle');
  const [pullRequest, setPullRequest] = useState<PullRequest>();
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduced = useReducedMotion();
  const totals = result.files.reduce((acc, file) => ({ additions: acc.additions + file.additions, deletions: acc.deletions + file.deletions }), { additions: 0, deletions: 0 });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(delay.current); };
  }, []);

  const openPullRequest = async () => {
    if (prStatus !== 'idle') return;
    setError('');
    setPrStatus('opening');
    try {
      if (onOpenPullRequest) {
        const pr = await onOpenPullRequest();
        if (!mounted.current) return;
        if (pr) setPullRequest(pr);
      } else {
        await new Promise<void>(resolve => { delay.current = setTimeout(resolve, 1100); });
        if (!mounted.current) return;
        setPullRequest({ number: 482, url: '' });
      }
      if (mounted.current) setPrStatus('opened');
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not open the pull request. Please try again.');
      setPrStatus('idle');
    }
  };

  const openedLabel = pullRequest ? `PR #${pullRequest.number} opened` : 'Pull request opened';
  const safeUrl = pullRequest?.url && /^https?:\/\//i.test(pullRequest.url) ? pullRequest.url : undefined;
  const labels = <span className="ar-pr-labels">{[
    { key: 'idle', text: 'Open pull request' }, { key: 'opening', text: 'Opening' }, { key: 'opened', text: openedLabel },
  ].map(label => <span key={label.key} aria-hidden={label.key !== prStatus} data-visible={label.key === prStatus}>{label.text}</span>)}</span>;

  return (
    <motion.div className="ar-result" initial={{ height: reduced ? 'auto' : 0, opacity: reduced ? 1 : 0 }} animate={{ height: 'auto', opacity: 1 }} transition={reduced ? { duration: 0 } : spring}>
      <div className="ar-result-inner">
        <StreamingSummary text={result.summary} />
        <div className="ar-files-heading"><span>{result.files.length} files changed</span><DiffStat {...totals} /></div>
        <div className="ar-result-files">{result.files.map(file => <ResultFile key={file.path} file={file} change={change} />)}</div>
        <div className="ar-result-checks">
          <span>{result.tests.passed === result.tests.total ? <CircleCheck size={15} className="ar-success" /> : <CircleStop size={15} className="ar-rejected-mark" />}{result.tests.passed} of {result.tests.total} tests passed</span>
          {result.checks.map(check => <span key={check.label}>{check.passed ? <CircleCheck size={15} className="ar-success" /> : <CircleStop size={15} className="ar-rejected-mark" />}{check.label}</span>)}
        </div>
        {safeUrl && prStatus === 'opened'
          ? <a className="ar-button ar-button-primary ar-pr-button" href={safeUrl} target="_blank" rel="noreferrer"><GithubMark />{labels}<ArrowUpRight size={14} /></a>
          : <button type="button" className="ar-button ar-button-primary ar-pr-button" onClick={openPullRequest} disabled={prStatus !== 'idle'}>{prStatus === 'opening' ? <LoaderCircle size={16} className="ar-spinner" /> : <GithubMark />}{labels}</button>}
        {error && <p className="ar-error" role="alert">{error}</p>}
        <p className={prStatus === 'opened' && !onOpenPullRequest ? 'ar-simulation-note' : 'sr-only'} aria-live="polite">
          {prStatus === 'opened' ? onOpenPullRequest ? `${openedLabel}.` : 'Preview only: PR #482 was simulated. No repository was changed.' : ''}
        </p>
      </div>
    </motion.div>
  );
}

export function AgentRun({
  task = 'Add rate limiting to the public API', model = defaultModel, script = sampleScript, run,
  autoPlay = true, onApprove, onReject, onOpenPullRequest, onRestart, className = '',
}: AgentRunProps) {
  const root = useRef<HTMLElement>(null);
  const stepsArea = useRef<HTMLDivElement>(null);
  const foldedButton = useRef<HTMLButtonElement>(null);
  const inView = useInView(root, { amount: 0.05 });
  const simulation = useSimulatedRun(script, { running: !run && inView });
  const state = run ?? simulation.state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const controlled = run !== undefined;
  const reduced = useReducedMotion();
  const [showSteps, setShowSteps] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const prefix = useId();
  const last = state.steps[state.steps.length - 1];
  const done = state.status === 'done';
  const stopped = done && !state.result;
  const idle = !run && !state.steps.length && !state.result;
  const statusText = idle ? 'Ready to start' : stopped ? 'Stopped' : done ? 'Done' : state.status === 'waiting' ? 'Waiting for you' : 'Working';
  const acceptedChange = [...state.steps].reverse().find(step => step.change && step.status === 'done')?.change;

  useEffect(() => { if (!run && autoPlay && inView) simulation.start(); }, [run, autoPlay, inView, simulation.start]);

  useEffect(() => {
    if (done && state.result) {
      if (stepsArea.current?.contains(document.activeElement)) requestAnimationFrame(() => foldedButton.current?.focus());
      setShowSteps(false);
    }
  }, [done, state.result]);

  const focusReview = useCallback((change: ProposedChange) => {
    const step = stateRef.current.steps.find(item => item.change?.id === change.id);
    if (step) requestAnimationFrame(() => document.getElementById(`${prefix}-${step.id}`)?.focus());
  }, [prefix]);

  const approve = useCallback((change: ProposedChange) => {
    try {
      setError('');
      onApprove?.(change);
      if (!controlled) simulation.approve(change);
      focusReview(change);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Approval failed. Please try again.'); }
  }, [onApprove, controlled, simulation.approve, focusReview]);

  const reject = useCallback((change: ProposedChange, reason: string) => {
    try {
      setError('');
      onReject?.(change, reason);
      if (!controlled) simulation.reject(change, reason);
      focusReview(change);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send your feedback. Please try again.'); }
  }, [onReject, controlled, simulation.reject, focusReview]);

  const restart = () => {
    try {
      onRestart?.();
      if (!run) simulation.restart();
      setGeneration(value => value + 1);
      setShowSteps(false);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restart the run.'); }
  };

  const announcement = stopped ? 'Run stopped. The changes were not written.'
    : done && state.result ? `Done in ${Math.round(state.elapsedMs / 1000)} seconds. ${state.result.tests.passed} of ${state.result.tests.total} tests passed.`
      : state.status === 'waiting' ? `Waiting for you. Review the ${last?.doneTarget ?? 'changes'}, then approve or reject.`
        : last ? `${last.verb}${last.target ? ` ${last.target}` : ''}.` : '';

  return (
    <section ref={root} className={`agent-run ${className}`} aria-labelledby={`${prefix}-task`} data-status={state.status}>
      <header className="ar-header">
        <div className="ar-title-row">
          <h2 id={`${prefix}-task`}>{task}</h2>
          <span className="ar-tooltip-wrap"><button type="button" className="ar-icon-button" aria-label="Restart run" onClick={restart}><RotateCcw size={16} strokeWidth={1.6} /></button><span className="ar-tooltip" aria-hidden="true">Restart run</span></span>
        </div>
        <div className="ar-meta-row">
          <span className="ar-model"><span aria-hidden="true">{model.mark}</span>{model.name}</span>
          <span className={`ar-status ar-status-${idle ? 'idle' : stopped ? 'stopped' : state.status}`}>
            {idle ? <Play size={13} /> : stopped ? <CircleStop size={14} /> : done ? <CircleCheck size={14} /> : state.status === 'waiting' ? <Hand size={14} /> : <LoaderCircle size={14} className="ar-spinner" />}
            <AnimatePresence initial={false} mode="popLayout"><motion.span key={statusText} initial={{ opacity: 0, y: reduced ? 0 : 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.16 }} className={state.status === 'working' && !idle ? 'ar-shimmer' : ''}>{statusText}</motion.span></AnimatePresence>
          </span>
          <span className="ar-elapsed" aria-label={`${Math.floor(state.elapsedMs / 1000)} seconds of work`}>{formatTime(state.elapsedMs)}</span>
        </div>
      </header>
      <div className="ar-steps-area" ref={stepsArea} key={generation}>
        {done && state.result && <button type="button" className="ar-folded-steps" ref={foldedButton} aria-expanded={showSteps} aria-controls={`${prefix}-steps`} onClick={() => setShowSteps(value => !value)}><ListChecks size={16} /><span>{state.steps.length} steps <span aria-hidden="true">&middot;</span> {Math.round(state.elapsedMs / 1000)}s</span><ChevronDown size={14} className={showSteps ? 'is-open' : ''} /></button>}
        <AnimatePresence initial={false}>
          {(!done || stopped || showSteps) && <motion.div key="steps" id={`${prefix}-steps`} className="ar-list-wrap" initial={{ height: reduced ? 'auto' : 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : spring}>
            <ol className="ar-steps" aria-label="Steps">{state.steps.map(step => <StepRow key={step.id} step={step} prefix={prefix} onApprove={approve} onReject={reject} />)}</ol>
          </motion.div>}
        </AnimatePresence>
        {idle && <div className="ar-idle"><p>Ready when you are. Follow the agent from plan to pull request.</p><button type="button" className="ar-button ar-button-primary" onClick={simulation.start}><Play size={14} />Start run</button></div>}
        {run && !state.steps.length && !done && <p className="ar-pending-event">Waiting for the first agent event...</p>}
      </div>
      {stopped && <div className="ar-stopped"><CircleStop size={18} /><div><h3>Run stopped</h3><p>The change was sent back. No files were written.</p><button type="button" className="ar-button ar-button-secondary" onClick={restart}><RotateCcw size={14} />Restart run</button></div></div>}
      {done && state.result && <RunResultView key={`result-${generation}`} result={state.result} change={acceptedChange} onOpenPullRequest={onOpenPullRequest} />}
      {error && <p className="ar-error ar-action-error" role="alert">{error}</p>}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}