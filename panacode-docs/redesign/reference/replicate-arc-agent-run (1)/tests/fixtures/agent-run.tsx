import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentRun, sampleChange, type AgentRunState, type RunScript } from '../../src/components/agent-run/agent-run';
import { sampleResult } from '../../src/components/agent-run/sample-script';
import '../../src/index.css';

const initial: AgentRunState = {
  status: 'waiting', elapsedMs: 2500,
  steps: [{ id: 'live-review', mark: 'review', verb: 'Preparing', doneVerb: 'Approved', doneTarget: 'changes to 2 files', status: 'waiting', change: sampleChange }],
};

const custom: RunScript = {
  steps: [
    { id: 'custom-read', mark: 'read', verb: 'Reading', doneVerb: 'Read', target: 'custom.ts', durationMs: 200 },
    { id: 'custom-review', mark: 'review', verb: 'Preparing', doneVerb: 'Approved', target: 'a custom change', durationMs: 200, change: { ...sampleChange, id: 'custom-change' } },
    { id: 'custom-write', mark: 'edit', verb: 'Writing', doneVerb: 'Wrote', target: 'custom.ts', durationMs: 200 },
  ],
  result: sampleResult,
};

function Fixture() {
  const [run, setRun] = useState(initial);
  const [event, setEvent] = useState('');
  const [attempts, setAttempts] = useState(0);
  const scenario = new URLSearchParams(location.search).get('scenario');
  return <main style={{ maxWidth: 760, margin: '40px auto', padding: 20 }}>
    {scenario === 'custom' || scenario === 'clock' ? <AgentRun task="A custom script" script={scenario === 'clock' ? { ...custom, steps: custom.steps.map(step => ({ ...step, durationMs: 1500 })) } : custom} autoPlay={false} /> : <AgentRun
      task="Live runtime task"
      model={{ name: 'Connected agent' }}
      run={run}
      onApprove={change => {
        setEvent(`approved:${change.id}`);
        setRun({ ...run, status: 'done', steps: run.steps.map(step => ({ ...step, status: 'done' })), result: sampleResult });
      }}
      onReject={(change, reason) => setEvent(`rejected:${change.id}:${reason}`)}
      onRestart={() => { setEvent('restarted'); setRun(initial); }}
      onOpenPullRequest={async () => {
        setAttempts(value => value + 1);
        if (attempts === 0) throw new Error('Repository unavailable. Try again.');
        setEvent('pull-request-opened');
        return { number: 917, url: 'https://example.com/pull/917' };
      }}
    />}
    <output aria-label="Runtime callback">{event}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);