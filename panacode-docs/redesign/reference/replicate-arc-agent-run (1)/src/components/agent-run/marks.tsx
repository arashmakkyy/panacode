import { FilePenLine, FilePlus, FileText, Search, Sparkle, Terminal } from 'lucide-react';
import type { StepMark } from './types';

export function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className="claude-mark" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <path d="m12 2 .5 7.5L17 3l-2.8 7L22 7l-6.5 5L23 14l-8 .5 4 6-6-4 1 7-3-7-4 6 2-7-7 3 5-5-7-1 7-1-5-6 7 4L8 2l3 7Z" />
      </g>
    </svg>
  );
}

export function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.07c-3.09.67-3.74-1.31-3.74-1.31-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.11.08 1.69 1.14 1.69 1.14.99 1.69 2.59 1.2 3.22.92.1-.71.39-1.2.7-1.48-2.47-.28-5.07-1.24-5.07-5.5 0-1.21.43-2.2 1.14-2.97-.11-.28-.49-1.4.11-2.91 0 0 .93-.3 3.05 1.13a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.05-1.13 3.05-1.13.6 1.51.22 2.63.11 2.91.71.77 1.14 1.76 1.14 2.97 0 4.27-2.6 5.22-5.08 5.5.4.34.75 1.02.75 2.06v3.04c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
    </svg>
  );
}

export function StepIcon({ mark }: { mark: StepMark }) {
  const icons = { think: Sparkle, read: FileText, search: Search, edit: FilePenLine, terminal: Terminal, review: FilePlus };
  if (mark === 'npm') {
    return <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true"><path fill="#cb3837" d="M0 5h18v7H9v2H5v-2H0Z" /><path fill="#fff" d="M2 6h4v5H5V7H4v4H2Zm5 0h4v5H9v1H7Zm2 1v3h1V7Zm3-1h5v5h-1V7h-1v4h-1V7h-1v4h-1Z" /></svg>;
  }
  if (mark === 'typescript') {
    return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="2" fill="#3178c6" /><path fill="#fff" d="M5 11h9v2H11v8H8v-8H5Zm11 6c-3-1.3-2.5-6.2 1.5-6.2 1.8 0 3 .7 3.5 2l-2 1c-.3-.7-.8-1-1.5-1-.8 0-1.2.4-1.2.9 0 .6.4.9 1.8 1.5 2.2.9 3 1.7 3 3.3 0 1.9-1.5 3-3.7 3-2 0-3.4-1-4-2.3l2-1.2c.5 1 1.1 1.4 2 1.4 1 0 1.4-.4 1.4-1s-.5-.9-2.8-1.9Z" /></svg>;
  }
  if (mark === 'github') return <GithubMark />;
  const Icon = icons[mark];
  return <Icon size={16} strokeWidth={1.65} aria-hidden="true" />;
}

export function DrawnCheck({ className = '' }: { className?: string }) {
  return <svg className={`drawn-check ${className}`} width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" pathLength="1" /></svg>;
}