import React from "react";
import { Folder, FileCode2 } from "lucide-react";

export default function FileTree({ rows, selected, onSelect }) {
  return (
    <nav className="font-mono text-[12.5px] py-3">
      {rows.map((row) =>
        row.type === "dir" ? (
          <div
            key={row.key}
            className="flex items-center gap-2 py-1.5 text-[#8f8b82]"
            style={{ paddingLeft: 16 + row.depth * 14 }}
          >
            <Folder className="w-3.5 h-3.5 shrink-0" />
            {row.name}/
          </div>
        ) : (
          <button
            key={row.key}
            onClick={() => onSelect(row.file.path)}
            className={`w-full flex items-center gap-2 py-1.5 pr-3 text-left transition-colors border-l-2 ${
              selected === row.file.path
                ? "border-[#3B6E57] bg-[#e9e6de] text-[#141414]"
                : "border-transparent text-[#4a4843] hover:bg-[#ebe8e1]"
            }`}
            style={{ paddingLeft: 14 + row.depth * 14 }}
          >
            <FileCode2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{row.name}</span>
          </button>
        )
      )}
    </nav>
  );
}