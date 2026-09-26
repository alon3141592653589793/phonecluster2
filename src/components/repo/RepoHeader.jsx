import React from "react";
import { Download } from "lucide-react";
import { repoFiles, buildSetupScript, downloadText } from "@/lib/repo";

const specs = [
  ["Target", "arm64-v8a · SDK 24→34"],
  ["Native", "NDK 26.1 · CMake 3.22"],
  ["Host", "Windows · adb :8080"],
  ["CI", "Actions → v0.1-testing"],
];

export default function RepoHeader() {
  return (
    <header className="pt-10 pb-8 md:pt-16 md:pb-12">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-[#3B6E57]">Base architecture · v0.1</p>
          <h1 className="font-display text-5xl md:text-6xl leading-[0.95] mt-3 text-[#141414]">
            PhoneCluster<span className="italic text-[#3B6E57]">App</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] text-[#5a5853] leading-relaxed">
            Single-phone USB AI compute node. Android daemon, C++ JNI bridge, PC runner and cloud CI — scaffolded.
          </p>
        </div>
        <button
          onClick={() => downloadText("setup_phonecluster.sh", buildSetupScript(repoFiles))}
          className="group inline-flex items-center gap-2 self-start md:self-auto rounded-full bg-[#141414] text-[#F3F1EC] pl-5 pr-4 py-3 text-sm font-medium transition-all hover:bg-[#3B6E57]"
        >
          Download setup script
          <Download className="w-4 h-4 transition-transform group-hover:translate-y-0.5" />
        </button>
      </div>
      <dl className="mt-10 grid grid-cols-2 md:grid-cols-4 border-t border-[#dcd8cf]">
        {specs.map(([k, v]) => (
          <div key={k} className="pt-4 pr-4 pb-2">
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8f8b82]">{k}</dt>
            <dd className="mt-1 text-sm text-[#141414]">{v}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}