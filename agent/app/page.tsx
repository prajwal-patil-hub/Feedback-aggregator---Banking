"use client";

import { useChat } from "@ai-sdk/react";

const EXAMPLES = [
  "Top 3 complaints about HDFC Bank this week",
  "Compare sentiment: ICICI vs SBI",
  "Show the worst negative reviews overall",
  "Which branch has the most 1-star feedback?",
];

export default function Home() {
  const { messages, input, handleInputChange, handleSubmit, status, setInput } =
    useChat({ api: "/api/chat" });

  const busy = status === "submitted" || status === "streaming";

  return (
    <main>
      <h1>Bank Feedback Insights Agent</h1>
      <p className="sub">
        Gemini + Vercel AI SDK · queries the aggregated feedback dataset via
        tool calls.
      </p>

      <div className="examples">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            onClick={() => setInput(q)}
          >
            {q}
          </button>
        ))}
      </div>

      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <div className="role">{m.role}</div>
          {m.parts?.map((part, i) => {
            if (part.type === "text") return <div key={i}>{part.text}</div>;
            if (part.type === "tool-invocation") {
              const t = part.toolInvocation;
              return (
                <div key={i} className="tool">
                  tool · {t.toolName}({JSON.stringify(t.args)})
                </div>
              );
            }
            return null;
          }) ?? <div>{m.content}</div>}
        </div>
      ))}

      <form onSubmit={handleSubmit}>
        <div className="bar">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Ask about bank feedback…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}
