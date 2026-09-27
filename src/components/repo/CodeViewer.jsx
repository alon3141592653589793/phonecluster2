import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, Download } from "lucide-react";
import { downloadText } from "@/lib/repo";

export default function CodeViewer({ file }) {
  const [copied, setCopied] = useState(false);
  const lines = file.content.replace(/\n$/, "").split("\n");

  const copy = async () => {
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="rounded-2xl bg-[#111214] text-[#E9E6DF] overflow-hidden shadow-[0_30px_60px_-30px_rgba(20,20,20,0.45)]">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/5">
        <div className="min-w-0">
          <p className="font-mono text-[12.5px] truncate">{file.path}</p>
          <p className="text-[12px] text-[#8a8780] mt-0.5 truncate">{file.description}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-widest text-[#6f6c66] mr-2">{file.lang}</span>
          <button
            onClick={copy}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              copied ? "bg-[#1f3a2e] text-[#7fc4a1]" : "bg-white/5 text-[#E9E6DF] hover:bg-white/10"
            }`}
            title="Copy file contents"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => downloadText(file.path.split("/").pop(), file.content)}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.pre
          key={file.path}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="font-mono text-[12.5px] leading-[1.7] overflow-auto max-h-[70vh] py-4"
        >
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-white/[0.03]">
              <span className="select-none w-12 shrink-0 text-right pr-4 text-[#4d4b47]">{i + 1}</span>
              <span className="pr-6 whitespace-pre">{line || " "}</span>
            </div>
          ))}
        </motion.pre>
      </AnimatePresence>
    </div>
  );
}