import { t, renderMessage, getLocale } from "../i18n/index.js";
import { useEffect, useRef, useId, type ReactNode } from 'react';
import { X, AlertCircle, LoaderCircle } from 'lucide-react';

export function Modal({ title, children, onClose, wide = false, dismissible = true }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return <dialog aria-labelledby={titleId} ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={(event) => { event.preventDefault(); if (dismissible) onClose(); }} onClick={(event) => { if (dismissible && event.target === event.currentTarget) onClose(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" disabled={!dismissible} onClick={onClose} aria-label={t("Close")}><X size={20} /></button></div>
    {children}
  </dialog>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="notice notice-error" role="alert"><AlertCircle size={18} /><span>{renderMessage(error instanceof Error ? error.message : String(error), getLocale())}</span></div>;
}
export function Loading({ label = t("Loading…") }: { label?: string }) { return <div className="loading" role="status"><LoaderCircle className="spin" size={20} />{label}</div>; }
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}
