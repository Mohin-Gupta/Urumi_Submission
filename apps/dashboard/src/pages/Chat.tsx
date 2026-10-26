import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, type ChatTurn, type ToolStep, type User } from "../api";
import { ErrorText, PageHeader } from "../ui";

type Entry = ChatTurn & { steps?: ToolStep[] };

const SUGGESTIONS = [
  { text: "What orders came in today?" },
  { text: "Create a product called Demo Mug priced at 299", adminOnly: true },
  { text: "Add a team note for each of today's orders saying the customer needs a follow-up call" },
];

function Steps({ steps }: { steps: ToolStep[] }) {
  return (
    <ul className="steps">
      {steps.map((s, i) => (
        <li key={i}>
          <details>
            <summary className={s.ok ? undefined : "failed"}>
              {s.ok ? "Called" : "Failed"} <code>{s.tool}</code>
            </summary>
            <pre>{JSON.stringify(s.args, null, 2)}</pre>
            <pre>{s.output}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}

function useStoredEntries(userId: number) {
  const storageKey = `chat:${userId}`;
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      // storage blocked: chat still works, it just forgets on page switch
    }
  }, [storageKey, entries]);
  return [entries, setEntries] as const;
}

export function Chat({ user }: { user: User }) {
  const [entries, setEntries] = useStoredEntries(user.id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next = [...entries, { role: "user" as const, content: text.trim() }];
    setEntries(next);
    setInput("");
    setError(undefined);
    setBusy(true);
    try {
      const messages = next.map(({ role, content }) => ({ role, content }));
      const { reply, steps } = await api<{ reply: string; steps: ToolStep[] }>("/chat", { body: { messages } });
      setEntries([...next, { role: "assistant", content: reply, steps }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <>
      <PageHeader title="Chat">
        Ask about the store in plain language. The assistant uses the same tools as your MCP clients, as {user.name}, and
        every call it makes is in the audit log.
      </PageHeader>

      <div className="chat">
        {entries.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.filter((s) => !s.adminOnly || user.role === "admin").map(({ text }) => (
              <button key={text} type="button" className="ghost" onClick={() => send(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`turn turn-${e.role}`}>
            {e.steps && e.steps.length > 0 && <Steps steps={e.steps} />}
            <p>{e.content}</p>
          </div>
        ))}
        {busy && <p className="muted thinking">Working on it…</p>}
        <ErrorText>{error}</ErrorText>
        <div ref={end} />
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask something, like: which orders are still processing?"
          rows={2}
          aria-label="Message"
        />
        <button disabled={busy || !input.trim()}>Send</button>
      </form>
    </>
  );
}
