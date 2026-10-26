import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api";

// A null path skips loading, for data only some users may see
export function useData<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    if (!path) return;
    await api<T>(path).then(
      (d) => (setData(d), setError(undefined)),
      (e: Error) => setError(e.message),
    );
  }, [path]);
  useEffect(() => {
    if (!path) return;
    reload();
    if (!pollMs) return;
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
  }, [path, reload, pollMs]);
  return { data, error, reload };
}

// Wraps a form submit: collects the fields, tracks busy state and shows the error message
export function useSubmit(action: (fields: Record<string, string>, form: HTMLFormElement) => Promise<void>) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setError(undefined);
    setBusy(true);
    try {
      await action(Object.fromEntries(new FormData(form)) as Record<string, string>, form);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { onSubmit, error, busy };
}

export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

// The Clipboard API only exists on HTTPS and localhost; plain-HTTP setups need the older textarea route
async function writeClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;opacity:0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Copy failed");
}

export function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy");
  const copy = () =>
    writeClipboard(text)
      .then(() => setLabel("Copied"), () => setLabel("Copy failed"))
      .finally(() => setTimeout(() => setLabel("Copy"), 1500));
  return (
    <button type="button" className="ghost small" onClick={copy}>
      {label}
    </button>
  );
}

export function CodeLine({ text }: { text: string }) {
  return (
    <div className="code-line">
      <code>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

// For values the server will only ever show once: new API keys and invite links
export function Reveal({ title, value, note, children, onDone }: {
  title: string;
  value: string;
  note: string;
  children?: ReactNode;
  onDone: () => void;
}) {
  return (
    <section className="reveal" role="status">
      <h2>{title}</h2>
      <CodeLine text={value} />
      <p className="muted">{note}</p>
      {children}
      <button type="button" className="ghost" onClick={onDone}>
        Done
      </button>
    </section>
  );
}

export const ErrorText = ({ children }: { children?: string }) => (children ? <p className="error">{children}</p> : null);

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return formatTime(iso);
}

export const claudeCommand = (key: string) =>
  `claude mcp add --transport http urumi ${window.location.origin}/mcp --header "Authorization: Bearer ${key}"`;
