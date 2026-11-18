import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Bookmark, Check, ChevronDown, ChevronRight, Code2, Copy, Eye, FileText, Info, Maximize2, Menu, Minimize2, Moon, Scan, Search, Smartphone, Sun, X } from 'lucide-react';
import { AgentRun } from './components/agent-run/agent-run';

const ARC = 'https://uiarc.dev';

const usageExamples = {
  Simulated: `import { AgentRun } from "@/components/agent-run/agent-run";\n\nexport default function AgentPanel() {\n  return <AgentRun />;\n}`,
  'Live runtime': `import { AgentRun } from "@/components/agent-run/agent-run";\n\nexport function AgentPanel({ run, task, agent }) {\n  return (\n    <AgentRun\n      task={task}\n      run={run}\n      onApprove={change => agent.approve(change.id)}\n      onReject={(change, reason) => agent.reject(change.id, reason)}\n      onOpenPullRequest={() => agent.openPullRequest()}\n      onRestart={() => agent.restart()}\n    />\n  );\n}`,
  'Manual start': `import { AgentRun } from "@/components/agent-run/agent-run";\n\nexport default function AgentPanel() {\n  return <AgentRun autoPlay={false} />;\n}`,
};
type Example = keyof typeof usageExamples;

const navGroups = [
  { name: 'AI', count: 18, items: ['AI chat', 'AI composer', 'Model picker', 'Prompt studio', 'Research run'] },
  { name: 'Agents', count: 10, items: ['Agent run', 'Agent tasks', 'Agent approvals', 'Agent routines', 'Agent orchestrator', 'MCP servers', 'Knowledge base', 'Eval suite', 'Agent builder', 'Agent gallery'] },
  { name: 'App shell', count: 7, items: ['Sidebar', 'Page header', 'Command palette', 'Notification center'] },
  { name: 'Developer', count: 6, items: ['API keys', 'Webhooks', 'Integrations', 'Environment variables'] },
];

const searchItems = [
  { title: 'Agent run', description: 'One agent, every step, your approval.', href: '#preview', group: 'Agents' },
  { title: 'Usage', description: 'Simulated runs and live runtime integration.', href: '#usage', group: 'On this page' },
  { title: 'API reference', description: 'Props, callbacks, and state.', href: '#api-reference', group: 'On this page' },
  { title: 'Keyboard interactions', description: 'Navigate and approve without a mouse.', href: '#keyboard', group: 'On this page' },
  ...navGroups.flatMap(group => group.items.filter(item => item !== 'Agent run').map(title => ({ title, description: `Explore ${title.toLowerCase()} on Arc.`, href: `${ARC}/components/blocks/${title.toLowerCase().replace(/ /g, '-')}`, group: group.name }))),
];

const apiRows = [
  ['task', 'string', 'The task shown in the card header.'],
  ['model', '{ name, mark? }', 'The model name and its decorative mark.'],
  ['run', 'AgentRunState', 'Live status, elapsed time, steps, and result from your runtime.'],
  ['script', 'RunScript', 'A custom simulation. Ignored when run is provided.'],
  ['autoPlay', 'boolean', 'Start when the card enters view. Defaults to true.'],
  ['onApprove', '(change) => void', 'Approve a proposed change before it is written.'],
  ['onReject', '(change, reason) => void', 'Send the change back with a short note.'],
  ['onOpenPullRequest', '() => Promise<PullRequest | void>', 'Open a real pull request and return its number and URL.'],
  ['onRestart', '() => void', 'Restart the connected agent. The simulation restarts itself.'],
  ['className', 'string', 'An additional class on the root section.'],
];

function ArcLogo({ size = 25 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M3 24V13a11 11 0 0 1 22 0v11M7.5 24V13a6.5 6.5 0 0 1 13 0v11M12 24V13a2 2 0 0 1 4 0v11" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" /></svg>;
}

function CopyButton({ value, label = 'Copy', className = '' }: { value: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  return <button type="button" className={`quiet-button ${className}`} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setState('copied'); }
    catch { setState('error'); }
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setState('idle'), 2200);
  }} aria-label={state === 'copied' ? 'Copied to clipboard' : state === 'error' ? 'Copy failed. Try again.' : label}>
    {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}<span>{state === 'copied' ? 'Copied' : state === 'error' ? 'Try again' : label}</span>
  </button>;
}

function HighlightedCode({ code }: { code: string }) {
  return <pre className="usage-code" tabIndex={0} aria-label="React usage example"><code>{code.split('\n').map((line, index) => {
    const segments = line.split(/("[^"]*"|'[^']*'|\b(?:import|from|export|default|function|return|const|false|true)\b|\/\/.*$)/g);
    return <span className="usage-code-line" key={index}><span className="usage-line-number" aria-hidden="true">{index + 1}</span><span>{segments.map((part, j) => <span key={j} className={/^['"]/.test(part) ? 'token-string' : /^(import|from|export|default|function|return|const|false|true)$/.test(part) ? 'token-keyword' : part.startsWith('//') ? 'token-comment' : ''}>{part}</span>)}{'\n'}</span></span>;
  })}</code></pre>;
}

function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => searchItems.filter(item => `${item.title} ${item.description} ${item.group}`.toLowerCase().includes(query.toLowerCase())).slice(0, 7), [query]);
  useEffect(() => {
    if (open) { setQuery(''); setSelected(0); dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [open]);
  const choose = (index: number) => {
    const item = results[index];
    if (!item) return;
    if (item.href.startsWith('#')) { onClose(); document.querySelector(item.href)?.scrollIntoView({ behavior: 'smooth' }); }
    else { window.open(item.href, '_blank', 'noopener,noreferrer'); onClose(); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(value => (value + 1) % Math.max(1, results.length)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => (value - 1 + results.length) % Math.max(1, results.length)); }
    if (event.key === 'Enter') { event.preventDefault(); choose(selected); }
  };
  return <dialog className="search-dialog" ref={dialog} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label="Search the library">
    <div className="search-dialog-inner">
      <div className="search-dialog-input"><Search size={19} /><input autoFocus value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={onKeyDown} placeholder="Search blocks and documentation..." aria-label="Search blocks and documentation" role="combobox" aria-expanded="true" aria-controls="search-results" aria-activedescendant={results[selected] ? `search-result-${selected}` : undefined} /><button type="button" onClick={onClose} className="icon-button" aria-label="Close search"><X size={16} /></button></div>
      <div className="search-results" id="search-results" role="listbox" aria-label="Search results">
        {results.length ? results.map((item, i) => <button type="button" key={item.title} role="option" aria-selected={i === selected} id={`search-result-${i}`} className={`search-result ${i === selected ? 'selected' : ''}`} onMouseEnter={() => setSelected(i)} onClick={() => choose(i)}><span className="search-result-icon">{item.group === 'On this page' ? <FileText size={18} /> : <Code2 size={18} />}</span><span><strong>{item.title}</strong><small>{item.description}</small></span>{item.href.startsWith('#') ? <ArrowRight size={15} /> : <ArrowUpRight size={15} />}</button>) : <div className="search-empty"><Search size={22} /><p>No results for "{query}"</p><span>Try "agent", "usage", or "API".</span></div>}
      </div>
      <div className="search-dialog-footer"><span><kbd>&uarr;</kbd><kbd>&darr;</kbd> to navigate</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
    </div>
  </dialog>;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('arc-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [groups, setGroups] = useState<Record<string, boolean>>({ AI: true, Agents: true, 'App shell': false, Developer: false });
  const [saved, setSaved] = useState(() => { try { return localStorage.getItem('arc-agent-saved') === 'true'; } catch { return false; } });
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [expanded, setExpanded] = useState(false);
  const [example, setExample] = useState<Example>('Simulated');
  const [autoPlay, setAutoPlay] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const [activeSection, setActiveSection] = useState('preview');
  const preview = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('arc-theme', theme); } catch { /* Theme works without storage. */ }
  }, [theme]);

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(value => !value); }
      if (event.key === 'Escape') setMobileNav(false);
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActiveSection(entry.target.id);
    }, { rootMargin: '-10% 0px -65% 0px', threshold: 0 });
    ['preview', 'usage', 'api-reference', 'keyboard'].forEach(id => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const outside = document.querySelectorAll<HTMLElement>('.site-header, .sidebar, .page-intro, .below-preview, .on-this-page');
    outside.forEach(el => { el.inert = true; });
    requestAnimationFrame(() => expandButton.current?.focus());
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setExpanded(false); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(preview.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href], input, [tabindex="0"]') ?? []).filter(el => el.offsetParent !== null && !el.closest('[inert], [hidden]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      outside.forEach(el => { el.inert = false; });
      document.removeEventListener('keydown', keydown);
      requestAnimationFrame(() => expandButton.current?.focus());
    };
  }, [expanded]);

  const toggleSaved = () => {
    setSaved(value => { try { localStorage.setItem('arc-agent-saved', String(!value)); } catch { /* Save remains available for this session. */ } return !value; });
  };
  const tryExample = () => {
    setAutoPlay(example !== 'Manual start');
    setRunKey(value => value + 1);
    setTab('preview');
    document.getElementById('preview')?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
  };
  const pageMarkdown = `# Agent run\n\nA single card that follows one AI coding agent through a task. Inspect tool calls, review a two-file diff, and approve changes before they are written.\n\nThis is an independent recreation of the public Arc preview. All agent actions and the default pull request are simulated.\n\n## Usage\n\n\`\`\`tsx\n${usageExamples['Live runtime']}\n\`\`\`\n\nOriginal: ${ARC}/components/blocks/agent-run`;

  return (
    <MotionConfig reducedMotion="user">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="site-header">
        <div className="header-start"><button type="button" className="icon-button mobile-menu" aria-label={mobileNav ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNav} aria-controls="sidebar" onClick={() => setMobileNav(value => !value)}>{mobileNav ? <X size={20} /> : <Menu size={20} />}</button><a href="#preview" className="brand" aria-label="Arc, agent run preview"><ArcLogo /><span>Arc</span></a>
          <nav className="top-nav" aria-label="Main navigation"><a href={`${ARC}/components`} target="_blank" rel="noreferrer">Components</a><a href="#preview" className="active" aria-current="page">Blocks</a><a href="#usage">Docs</a><a href={`${ARC}/pricing`} target="_blank" rel="noreferrer">Pricing</a></nav>
        </div>
        <div className="header-end"><a href={`${ARC}/components/blocks/agent-run`} target="_blank" rel="noreferrer" className="original-link">View on Arc <ArrowUpRight size={14} /></a><span className="header-divider" /><button type="button" className="icon-button theme-button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}><AnimatePresence mode="wait" initial={false}><motion.span key={theme} initial={{ opacity: 0, rotate: reduced ? 0 : -35 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: reduced ? 0 : 35 }} transition={{ duration: reduced ? 0 : .15 }}>{theme === 'light' ? <Sun size={18} strokeWidth={1.7} /> : <Moon size={18} strokeWidth={1.7} />}</motion.span></AnimatePresence></button><a href={`${ARC}/pricing`} target="_blank" rel="noreferrer" className="get-pro">Get Pro <ArrowUpRight size={13} /></a></div>
      </header>

      {mobileNav && <button type="button" className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'is-visible' : ''}`} id="sidebar" aria-label="Block library">
        <button type="button" className="sidebar-search" onClick={() => { setMobileNav(false); setSearchOpen(true); }}><Search size={14} /><span>Search the library</span><kbd>Ctrl K</kbd></button>
        <div className="sidebar-type-nav"><a href={`${ARC}/components`} target="_blank" rel="noreferrer">Components</a><a href="#preview" className="active" onClick={() => setMobileNav(false)}>Blocks</a><a href={`${ARC}/components?category=special`} target="_blank" rel="noreferrer">Special</a></div>
        <div className="sidebar-scroll">
          {navGroups.map(group => <div className="nav-group" key={group.name}><button type="button" className="nav-group-label" aria-expanded={!!groups[group.name]} aria-controls={`group-${group.name.replace(/ /g, '-')}`} onClick={() => setGroups(value => ({ ...value, [group.name]: !value[group.name] }))}><ChevronDown size={12} className={groups[group.name] ? '' : 'is-closed'} /><span>{group.name}</span><span className="nav-count">{group.count}</span></button>
            {groups[group.name] && <nav id={`group-${group.name.replace(/ /g, '-')}`} aria-label={`${group.name} blocks`}>{group.items.map(item => <a key={item} href={item === 'Agent run' ? '#preview' : `${ARC}/components/blocks/${item.toLowerCase().replace(/ /g, '-')}`} target={item === 'Agent run' ? undefined : '_blank'} rel={item === 'Agent run' ? undefined : 'noreferrer'} className={`sidebar-link ${item === 'Agent run' ? 'active' : ''}`} aria-current={item === 'Agent run' ? 'page' : undefined} onClick={() => setMobileNav(false)}><span>{item}</span><span className="tiny-pro">Pro</span></a>)}</nav>}
          </div>)}
          <div className="built-from"><span className="built-from-label">Built from</span>{['Button', 'Input', 'Text shimmer', 'Tooltip'].map(name => <a key={name} href={`${ARC}/components/${name.toLowerCase().replace(/ /g, '-')}`} target="_blank" rel="noreferrer">{name}<ArrowUpRight size={11} /></a>)}</div>
        </div>
        <a className="whats-new" href={`${ARC}/docs/changelog`} target="_blank" rel="noreferrer"><span className="tiny-status-dot" />What's new<ArrowUpRight size={13} /></a>
      </aside>

      <main id="main" className="workspace">
        <div className="main-layout">
          <div className="page-content">
            <motion.div className="page-intro" initial={{ opacity: 0, y: reduced ? 0 : 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .35 }}>
              <nav className="breadcrumb" aria-label="Breadcrumb"><a href={`${ARC}/components/blocks`} target="_blank" rel="noreferrer">Blocks</a><ChevronRight size={12} /><span>Agents</span><ChevronRight size={12} /><span aria-current="page">Agent run</span></nav>
              <div className="page-title-row"><h1>Agent run</h1><span className="pro-badge">Pro</span></div>
              <p className="page-description">One AI coding agent, from task to pull request. Follow every step, inspect tool calls, and approve the changes before anything is written.</p>
              <div className="page-heading-bottom"><span className="block-category"><Code2 size={13} />Interactive block</span><div className="page-actions"><button type="button" className={`quiet-button ${saved ? 'is-saved' : ''}`} aria-pressed={saved} onClick={toggleSaved}><Bookmark size={13} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}</button><CopyButton value={pageMarkdown} label="Copy page" /></div></div>
            </motion.div>

            {expanded && <div className="expanded-backdrop" aria-hidden="true" />}
            <div id="preview" ref={preview} className={`preview-shell ${expanded ? 'is-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? 'true' : undefined} aria-label={expanded ? 'Expanded agent run preview' : undefined}>
              <div className="preview-toolbar">
                <div className="preview-tabs" role="tablist" aria-label="Component view">
                  <button type="button" role="tab" id="preview-tab" aria-selected={tab === 'preview'} aria-controls="preview-panel" tabIndex={tab === 'preview' ? 0 : -1} className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'End'].includes(event.key)) { event.preventDefault(); setTab('code'); document.getElementById('code-tab')?.focus(); } }}><Eye size={14} />Preview</button>
                  <button type="button" role="tab" id="code-tab" aria-selected={tab === 'code'} aria-controls="code-panel" tabIndex={tab === 'code' ? 0 : -1} className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); setTab('preview'); document.getElementById('preview-tab')?.focus(); } }}><Code2 size={14} />Code</button>
                </div>
                <div className="preview-tools"><span className="sample-data"><span />Live block <span className="sample-separator">&middot;</span> sample data</span><div className="device-switch" aria-label="Preview size"><button type="button" className={device === 'desktop' ? 'active' : ''} aria-label="Desktop preview" title="Desktop preview" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Scan size={14} /></button><button type="button" className={device === 'mobile' ? 'active' : ''} aria-label="Mobile preview" title="Mobile preview" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone size={13} /></button></div><button type="button" ref={expandButton} className="icon-button expand-button" title={expanded ? 'Exit expanded preview' : 'Expand preview'} aria-label={expanded ? 'Exit expanded preview' : 'Expand preview'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div>
              </div>
              <div id="preview-panel" role="tabpanel" aria-labelledby="preview-tab" hidden={tab !== 'preview'}>
                <div className="preview-stage" data-device={device}>
                  <motion.div className="agent-container" animate={{ maxWidth: device === 'mobile' ? 375 : 720 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}><AgentRun key={runKey} autoPlay={autoPlay} /></motion.div>
                </div>
                <div className="preview-caption"><Info size={12} /><span>Simulated run. No code is executed and no repository is changed.</span></div>
              </div>
              <div id="code-panel" role="tabpanel" aria-labelledby="code-tab" hidden={tab !== 'code'} className="preview-code-panel">
                <div className="code-panel-intro"><Code2 size={21} /><h2>One component. Your agent.</h2><p>Use the simulation as-is, or connect your runtime with a few callbacks.</p></div>
                <div className="code-example"><div className="code-example-header"><span><FileText size={13} />agent-panel.tsx</span><CopyButton value={usageExamples['Live runtime']} /></div><HighlightedCode code={usageExamples['Live runtime']} /></div>
                <p className="code-preview-note">This is an independent implementation of the public preview. The original Arc Pro source is available <a href={`${ARC}/components/blocks/agent-run`} target="_blank" rel="noreferrer">on Arc <ArrowUpRight size={11} /></a>.</p>
              </div>
            </div>

            <div className="below-preview">
              <section className="docs-section" id="usage"><div className="section-heading"><h2>Usage</h2><BookOpen size={17} /></div><p>Start with a simulated run. Connect your agent when you are ready.</p>
                <div className="usage-tabs" role="tablist" aria-label="Usage examples">{(Object.keys(usageExamples) as Example[]).map((name, i, names) => <button type="button" key={name} role="tab" id={`usage-tab-${i}`} aria-selected={example === name} aria-controls="usage-example-panel" tabIndex={example === name ? 0 : -1} className={example === name ? 'active' : ''} onClick={() => setExample(name)} onKeyDown={event => {
                  let next = i;
                  if (event.key === 'ArrowRight') next = (i + 1) % names.length;
                  else if (event.key === 'ArrowLeft') next = (i - 1 + names.length) % names.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = names.length - 1;
                  else return;
                  event.preventDefault(); setExample(names[next]); document.getElementById(`usage-tab-${next}`)?.focus();
                }}>{name}</button>)}</div>
                <div className="code-example" role="tabpanel" id="usage-example-panel" aria-labelledby={`usage-tab-${Object.keys(usageExamples).indexOf(example)}`}><div className="code-example-header"><span><FileText size={13} />example.tsx</span><CopyButton value={usageExamples[example]} /></div><HighlightedCode code={usageExamples[example]} /></div>
                <div className="usage-note"><p>{example === 'Live runtime' ? 'Your runtime owns the state. The card renders exactly what you pass.' : example === 'Manual start' ? 'Set autoPlay to false to let the user start the run.' : 'The clock pauses off screen, in a hidden tab, and while waiting for approval.'}</p>{example !== 'Live runtime' && <button type="button" className="text-button" onClick={tryExample}>Try this example <ArrowRight size={13} /></button>}</div>
              </section>

              <section className="docs-section" id="api-reference"><div className="section-heading"><h2>API reference</h2><span className="section-code-label">&lt;AgentRun /&gt;</span></div><p>A small interface for the whole run.</p><div className="api-table-wrap"><table className="api-table"><thead><tr><th>Prop</th><th>Type</th><th>Description</th></tr></thead><tbody>{apiRows.map(([prop, type, description]) => <tr key={prop}><td><code>{prop}</code></td><td><code>{type}</code></td><td>{description}</td></tr>)}</tbody></table></div></section>

              <section className="docs-section" id="keyboard"><div className="section-heading"><h2>Keyboard interactions</h2></div><p>Every part of the run works without a pointer.</p><div className="keyboard-list">
                <div><span><kbd>Tab</kbd></span><p>Move through steps, files, and actions.</p></div>
                <div><span><kbd>Enter</kbd><kbd>Space</kbd></span><p>Open a tool call or expand the completed steps.</p></div>
                <div><span><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>Home</kbd><kbd>End</kbd></span><p>Switch between files in the diff.</p></div>
                <div><span><kbd>Enter</kbd></span><p>Send your rejection note to the agent.</p></div>
                <div><span><kbd>Esc</kbd></span><p>Cancel a note, close search, or leave the expanded preview.</p></div>
              </div><p className="accessibility-note">Includes screen reader announcements, visible keyboard focus, and reduced motion support.</p></section>
              <footer className="page-footer"><span><ArcLogo size={17} />Details make the difference.</span><a href={`${ARC}/components/blocks/agent-run`} target="_blank" rel="noreferrer">Original on Arc <ArrowUpRight size={13} /></a></footer>
            </div>
          </div>
          <aside className="on-this-page" aria-label="On this page"><div><h2>On this page</h2><nav>{[['preview', 'Preview'], ['usage', 'Usage'], ['api-reference', 'API reference'], ['keyboard', 'Keyboard']].map(([id, label]) => <a href={`#${id}`} className={activeSection === id ? 'active' : ''} key={id} onClick={() => setActiveSection(id)}>{label}</a>)}</nav><a className="toc-source" href={`${ARC}/components/blocks/agent-run/markdown`} target="_blank" rel="noreferrer"><FileText size={12} />View as Markdown<ArrowUpRight size={11} /></a><a className="toc-bottom-link" href="#usage">Start building<ArrowDown size={12} /></a></div></aside>
        </div>
      </main>
      <SearchDialog open={searchOpen} onClose={closeSearch} />
    </MotionConfig>
  );
}
