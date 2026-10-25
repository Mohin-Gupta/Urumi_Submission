import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api";

export function useData<T>(path: string, pollMs?: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(
    () =>
      api<T>(path).then(
        (d) => (setData(d), setError(undefined)),
        (e: Error) => setError(e.message),
      ),
    [path],
  );
  useEffect(() => {
    reload();
    if (!pollMs) return;
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
  }, [reload, pollMs]);
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

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="ghost small" onClick={copy}>
      {copied ? "Copied" : "Copy"}
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
