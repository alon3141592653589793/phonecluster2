// DEBUG ONLY — remove <DebugRecorder /> from App.jsx before public release.
import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Bug, Copy, Send, Trash2, X } from "lucide-react";

function ts() {
  return new Date().toISOString().split("T")[1].replace("Z", "");
}

function describe(el) {
  if (!el) return "?";
  const tag = (el.tagName || "?").toLowerCase();
  let label = el.getAttribute?.("aria-label") || el.getAttribute?.("data-testid") || "";
  if (!label) {
    const txt = (el.innerText || "").trim().slice(0, 40);
    if (txt) label = txt;
  }
  if (!label && el.id) label = "#" + el.id;
  return `${tag}${label ? ":" + label : ""}`;
}

export default function DebugRecorder() {
  const logRef = useRef([]);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const record = (entry) => {
    const line = `[${ts()}] ${entry}`;
    logRef.current.push(line);
    if (logRef.current.length > 2000) logRef.current = logRef.current.slice(-2000);
    setLog([...logRef.current]);
  };

  useEffect(() => {
    record("session_start");
    const onClick = (e) => {
      const t = e.target.closest("button, a, [role=button], input, select, textarea, [data-testid]");
      record(`click ${describe(t || e.target)}`);
    };
    const onInput = (e) => {
      const el = e.target;
      const tag = (el.tagName || "").toLowerCase();
      if (!tag) return;
      const name = el.getAttribute("name") || el.getAttribute("aria-label") || el.placeholder || tag;
      let val = el.value;
      if (el.type === "password" || String(name).toLowerCase().includes("password")) val = "***";
      record(`input ${name}="${String(val).slice(0, 80)}"`);
    };
    const onNav = () => record(`nav ${location.pathname}${location.search}`);
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    window.addEventListener("popstate", onNav);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("popstate", onNav);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logRef.current.join("\n"));
      setStatus("copied to clipboard");
    } catch (e) {
      setStatus("copy failed: " + e.message);
    }
    setTimeout(() => setStatus(""), 1500);
  };

  const send = async () => {
    setSending(true);
    setStatus("sending…");
    try {
      const res = await base44.functions.invoke("PushSessionLog", { content: logRef.current.join("\n") });
      if (res?.data?.ok) setStatus("sent ✓ " + (res.data.url || ""));
      else setStatus("error: " + (res?.data?.error || "unknown"));
    } catch (e) {
      setStatus("error: " + e.message);
    } finally {
      setSending(false);
    }
  };

  const clear = () => { logRef.current = []; setLog([]); setStatus(""); };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-[9999] h-11 w-11 rounded-full bg-red-600 text-white shadow-lg flex items-center justify-center"
        title="DEBUG session recorder (remove before public)"
      >
        <Bug className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed bottom-20 right-4 z-[9999] w-[92vw] max-w-md rounded-xl border border-red-300 bg-white shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-red-200 bg-red-50">
            <span className="font-mono text-[11px] uppercase tracking-wider text-red-700">DEBUG recorder — remove before public</span>
            <button onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
          </div>
          <pre className="max-h-64 overflow-auto p-3 text-[11px] font-mono whitespace-pre-wrap break-words bg-[#1a1a1a] text-[#e8e6e1]">{log.join("\n") || "(no events yet)"}</pre>
          <div className="flex gap-2 p-2 border-t border-red-200">
            <button onClick={copy} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-[#dcd8cf]"><Copy className="h-3.5 w-3.5" /> Copy</button>
            <button onClick={send} disabled={sending} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-red-600 text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Send to GitHub</button>
            <button onClick={clear} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-[#dcd8cf] ml-auto"><Trash2 className="h-3.5 w-3.5" /> Clear</button>
          </div>
          {status && <div className="px-3 pb-2 text-[11px] font-mono text-red-700 break-words">{status}</div>}
        </div>
      )}
    </>
  );
}