import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRunState, AgentStep, ProposedChange, RunResult, RunScript, ScriptStep } from './types';

const emptyState = (): AgentRunState => ({ status: 'working', elapsedMs: 0, steps: [] });

function beginStep(step: ScriptStep): AgentStep {
  const { revise: _revise, ...rest } = step;
  return { ...rest, status: 'running', elapsedMs: 0, progress: step.progress ? { ...step.progress, value: 0 } : undefined };
}

export function useSimulatedRun(script: RunScript, options: { running: boolean }) {
  const [state, setState] = useState<AgentRunState>(emptyState);
  const stateRef = useRef(state);
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const clock = useRef({
    active: false,
    timeline: [] as ScriptStep[],
    cursor: 0,
    stepTime: 0,
    revisionCount: 0,
    result: script.result as RunResult,
  });

  const commit = useCallback((next: AgentRunState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const restart = useCallback(() => {
    const currentScript = scriptRef.current;
    clock.current = {
      active: currentScript.steps.length > 0,
      timeline: [...currentScript.steps],
      cursor: 0,
      stepTime: 0,
      revisionCount: 0,
      result: currentScript.result,
    };
    commit(currentScript.steps.length
      ? { status: 'working', elapsedMs: 0, steps: [beginStep(currentScript.steps[0])] }
      : { status: 'done', elapsedMs: 0, steps: [], result: currentScript.result });
  }, [commit]);

  const start = useCallback(() => {
    if (stateRef.current.steps.length === 0 && !stateRef.current.result) restart();
  }, [restart]);

  const advance = useCallback((current: AgentRunState, steps: AgentStep[]) => {
    const engine = clock.current;
    engine.cursor += 1;
    engine.stepTime = 0;
    const next = engine.timeline[engine.cursor];
    if (next) {
      commit({ ...current, status: 'working', steps: [...steps, beginStep(next)] });
    } else {
      engine.active = false;
      commit({ ...current, status: 'done', steps, result: engine.result });
    }
  }, [commit]);

  const approve = useCallback((change?: ProposedChange) => {
    const current = stateRef.current;
    const last = current.steps[current.steps.length - 1];
    if (current.status !== 'waiting' || !last?.change || (change && last.change.id !== change.id)) return;
    if (last.change.outcome) clock.current.result = last.change.outcome;
    advance(current, current.steps.map((step, i) => i === current.steps.length - 1 ? { ...step, status: 'done' } : step));
  }, [advance]);

  const reject = useCallback((change: ProposedChange, reason: string) => {
    const current = stateRef.current;
    const engine = clock.current;
    const last = current.steps[current.steps.length - 1];
    if (current.status !== 'waiting' || last?.change?.id !== change.id || !reason.trim()) return;
    const steps = current.steps.map((step, i): AgentStep => i === current.steps.length - 1
      ? { ...step, status: 'rejected', doneVerb: 'Sent back', reason: reason.trim() }
      : step);
    const revision = engine.timeline[engine.cursor]?.revise;
    if (engine.revisionCount === 0 && revision?.length) {
      engine.revisionCount += 1;
      engine.timeline.splice(engine.cursor + 1, 0, ...revision);
      advance(current, steps);
    } else {
      engine.active = false;
      commit({ ...current, status: 'done', steps });
    }
  }, [advance, commit]);

  useEffect(() => {
    if (!options.running || state.status !== 'working' || !state.steps.length || !clock.current.active) return;
    let frame = 0;
    let previous = performance.now();
    let accumulated = 0;

    const tick = (now: number) => {
      const engine = clock.current;
      const current = stateRef.current;
      const delta = Math.min(now - previous, 100);
      previous = now;

      if (document.visibilityState === 'visible' && engine.active && current.status === 'working') {
        accumulated += delta;
        if (accumulated >= 40) {
          const scriptStep = engine.timeline[engine.cursor];
          const amount = Math.min(accumulated, Math.max(0, scriptStep.durationMs - engine.stepTime));
          engine.stepTime += amount;
          accumulated = 0;
          const elapsedMs = current.elapsedMs + amount;
          const last = current.steps[current.steps.length - 1];
          const progress = last.progress
            ? { ...last.progress, value: Math.min(last.progress.total, Math.floor(engine.stepTime / Math.max(1, scriptStep.durationMs) * last.progress.total)) }
            : undefined;
          const finished = engine.stepTime >= scriptStep.durationMs;
          const updated: AgentStep = {
            ...last,
            elapsedMs: engine.stepTime,
            progress,
            status: finished ? (last.change ? 'waiting' : 'done') : 'running',
          };
          // Completed rows retain their references; only the live row changes on a beat.
          const steps = [...current.steps.slice(0, -1), updated];
          if (finished && !last.change) advance({ ...current, elapsedMs }, steps);
          else commit({ ...current, elapsedMs, steps, status: finished ? 'waiting' : 'working' });
        }
      } else accumulated = 0;
      if (document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      cancelAnimationFrame(frame);
      previous = performance.now();
      accumulated = 0;
      if (document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    if (document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [options.running, state.status, state.steps.length, advance, commit]);

  return { state, start, restart, approve, reject };
}