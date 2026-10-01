import React, { useMemo, useState } from "react";
import RepoHeader from "@/components/repo/RepoHeader";
import FileTree from "@/components/repo/FileTree";
import CodeViewer from "@/components/repo/CodeViewer";
import ProjectDashboard from "@/components/project/ProjectDashboard";
import { repoFiles, buildRows } from "@/lib/repo";

export default function Home() {
  const [tab, setTab] = useState("project");
  const rows = useMemo(() => buildRows(repoFiles), []);
  const [selected, setSelected] = useState(".github/workflows/build-pipeline.yml");
  const file = repoFiles.find((f) => f.path === selected);

  return (
    <div className="min-h-screen bg-[#F3F1EC] text-[#141414]">
      <div className="max-w-7xl mx-auto px-5 md:px-10 pb-20">
        <RepoHeader />
        <div className="flex gap-1 mb-6 border-b border-[#dcd8cf]">
          {[
            ["project", "Project"],
            ["source", "Source code"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] -mb-px border-b-2 transition ${
                tab === k ? "border-[#141414] text-[#141414]" : "border-transparent text-[#8f8b82] hover:text-[#141414]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "project" ? (
          <ProjectDashboard />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 lg:gap-10">
            <aside className="lg:sticky lg:top-6 self-start">
              <div className="flex items-baseline justify-between mb-2 px-1">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8f8b82]">Repository</h2>
                <span className="font-mono text-[10px] text-[#8f8b82]">{repoFiles.length} files</span>
              </div>
              <div className="rounded-2xl border border-[#dcd8cf] bg-[#F7F5F1] max-h-[40vh] lg:max-h-[75vh] overflow-y-auto">
                <FileTree rows={rows} selected={selected} onSelect={setSelected} />
              </div>
            </aside>
            <main className="min-w-0">{file && <CodeViewer file={file} />}</main>
          </div>
        )}
      </div>
    </div>
  );
}