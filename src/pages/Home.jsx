import React, { useMemo, useState } from "react";
import RepoHeader from "@/components/repo/RepoHeader";
import FileTree from "@/components/repo/FileTree";
import CodeViewer from "@/components/repo/CodeViewer";
import { repoFiles, buildRows } from "@/lib/repo";

export default function Home() {
  const rows = useMemo(() => buildRows(repoFiles), []);
  const [selected, setSelected] = useState(".github/workflows/build-pipeline.yml");
  const file = repoFiles.find((f) => f.path === selected);

  return (
    <div className="min-h-screen bg-[#F3F1EC] text-[#141414]">
      <div className="max-w-7xl mx-auto px-5 md:px-10 pb-20">
        <RepoHeader />
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 lg:gap-10">
          <aside className="lg:sticky lg:top-6 self-start">
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8f8b82]">Repository</h2>
              <span className="font-mono text-[10px] text-[#8f8b82]">{repoFiles.length} files</span>
            </div>
            <div className="rounded-2xl border border-[#dcd8cf] bg-[#F7F5F1] max-h-[40vh] lg:max-h-[75vh] overflow-y-auto">
              <FileTree rows={rows} selected={selected} onSelect={setSelected} />
            </div>
            <p className="mt-4 px-1 text-[12px] leading-relaxed text-[#8f8b82]">
              Run the setup script in an empty folder, then push to GitHub — the pipeline builds the APK and publishes the release.
            </p>
          </aside>
          <main className="min-w-0">{file && <CodeViewer file={file} />}</main>
        </div>
      </div>
    </div>
  );
}