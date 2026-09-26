import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Filter } from 'lucide-react';

export function FilterMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();

  // Reposition after filter changes as well as viewport and table scrolling.
  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!trigger.current || !popover.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const panel = popover.current;
      const edge = 16; const gap = 8;
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      const below = Math.max(0, viewport.height - anchor.bottom - gap - edge);
      const above = Math.max(0, anchor.top - gap - edge);
      const preferredHeight = Math.min(440, viewport.height * 0.65);
      panel.style.maxHeight = `${preferredHeight}px`;
      const upward = below < panel.getBoundingClientRect().height && above > below;
      panel.style.maxHeight = `${Math.min(preferredHeight, upward ? above : below)}px`;
      const bounds = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(edge, Math.min(anchor.right - bounds.width, viewport.width - bounds.width - edge))}px`;
      panel.style.top = `${Math.max(edge, Math.min(upward ? anchor.top - gap - bounds.height : anchor.bottom + gap, viewport.height - bounds.height - edge))}px`;
    }
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  });

  useEffect(() => {
    if (!open) return;
    popover.current?.querySelector('input')?.focus({ preventScroll: true });
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popover.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div className="filter-menu">
    <button type="button" ref={trigger} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><Filter size={13} /><ChevronDown size={10} /></button>
    {open && createPortal(<div id={id} ref={popover} className="filter-popover">{children}</div>, document.body)}
  </div>;
}
