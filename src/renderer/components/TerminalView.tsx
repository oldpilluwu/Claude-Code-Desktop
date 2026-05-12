import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SessionRecord } from '@/hooks/useSessions';

interface TerminalViewProps {
  session: SessionRecord;
  onClose: () => void;
}

function labelFor(s: SessionRecord): string {
  const folder = s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd;
  return `${folder} · ${s.model || 'default'}`;
}

export function TerminalView({ session, onClose }: TerminalViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const el = containerRef.current;
    if (!shell || !el) return;

    let resizeFrame: number | null = null;
    const fitTerminal = () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        try {
          session.fitAddon.fit();
        } catch { /* ignore */ }
      });
    };

    if (session.term.element) {
      el.appendChild(session.term.element);
    } else {
      session.term.open(el);
    }
    fitTerminal();
    session.term.focus();

    const ro = new ResizeObserver(fitTerminal);
    ro.observe(shell);
    window.addEventListener('resize', fitTerminal);

    return () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      ro.disconnect();
      window.removeEventListener('resize', fitTerminal);
      const termEl = session.term.element;
      if (termEl && termEl.parentNode === el) el.removeChild(termEl);
    };
  }, [session]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <span className="text-xs text-muted-foreground">{labelFor(session)}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" /> End Session
        </Button>
      </div>
      <div ref={shellRef} className="min-h-0 flex-1 overflow-hidden bg-black p-2">
        <div ref={containerRef} className="terminal-host h-full min-h-0 overflow-hidden" />
      </div>
    </div>
  );
}
