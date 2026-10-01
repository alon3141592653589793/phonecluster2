import React from "react";
import { Cpu, Smartphone, Network, Github } from "lucide-react";

const WANTED = [
  { name: "Cluster multiple Androids into one compute pool", status: "done" },
  { name: "On-device LLM inference (llama.cpp / TinyLlama 1.1B)", status: "done" },
  { name: "Phone as alternative CPU (parallel matmul benchmark)", status: "done" },
  { name: "Phone as alternative GPU (EGL/GLES probe + benchmark)", status: "partial" },
  { name: "Phone as alternative NPU (NNAPI inference)", status: "not" },
  { name: "Phone RAM aggregated/pooled across nodes", status: "partial" },
  { name: "USB-tethered compute node (browser console, no PC app)", status: "done" },
  { name: "LAN auto-discovery (mDNS / DNS-SD + subnet scan)", status: "done" },
  { name: "Distributed inference fan-out across all nodes", status: "done" },
  { name: "In-app cluster console (fake PC, no PC needed)", status: "done" },
  { name: "Hardware media codec enumeration (H.264 / H.265)", status: "done" },
  { name: "CI/CD: auto-build APK + PC bridge + GitHub release", status: "done" },
  { name: "Stable APK signing for Obtainium auto-updates", status: "untested" },
  { name: "GPU compute shaders for ML workloads", status: "not" },
  { name: "Load-balanced scheduling / work stealing", status: "not" },
  { name: "Result aggregation / best-response selection", status: "not" },
  { name: "API authentication / access control", status: "not" },
];

const CURRENT = [
  { title: "Compute daemon", detail: "Foreground service with WakeLock + WifiLock — runs with the screen off. NanoHTTPD on 0.0.0.0:8080 + 8081 (every interface).", icon: Smartphone },
  { title: "GET /v1/info", detail: "Live node metrics: device model, CPU cores, free RAM, ABI, loaded modules, uptime.", icon: Cpu },
  { title: "POST /v1/completions", detail: "Real llama.cpp inference via JNI (TinyLlama 1.1B Q4_K_M). Also /v1/chat/completions.", icon: Cpu },
  { title: "GET /v1/cpu/bench", detail: "Parallel matrix-multiply benchmark across all cores, reports GFLOPS.", icon: Cpu },
  { title: "GET /v1/gpu/info", detail: "EGL/GLES renderer, vendor, version, extensions + a clear-rate benchmark.", icon: Cpu },
  { title: "GET /v1/media/info", detail: "Enumerates hardware + software encoders and decoders (H.264, H.265, …).", icon: Cpu },
  { title: "Cluster API", detail: "/v1/cluster/nodes, /v1/cluster/info (total cores + RAM), /v1/cluster/completions (fan-out to every node).", icon: Network },
  { title: "Discovery", detail: "mDNS/DNS-SD advertises each node; the orchestrator subnet-scans for peers on the LAN.", icon: Network },
  { title: "Cluster console", detail: "In-app 'fake PC': discover nodes, dispatch to both local nodes or to the whole cluster.", icon: Smartphone },
  { title: "CI/CD", detail: "GitHub Actions builds the arm64-v8a APK + PC bridge and publishes a prerelease for Obtainium.", icon: Github },
];

const NOT_YET = [
  { title: "NPU / NNAPI module", detail: "No NNAPI delegate yet — phone AI accelerators aren't exposed for inference." },
  { title: "GPU compute shaders", detail: "Only a GLES clear benchmark today; no compute-shader ML kernels." },
  { title: "True RAM pooling", detail: "Only aggregated free-RAM reporting; no shared or paged memory across nodes." },
  { title: "Smart scheduling", detail: "Fan-out to all nodes today; no load-balancing, work-stealing, or job queue." },
  { title: "Result aggregation", detail: "Returns every node's response; no best-answer selection or voting." },
  { title: "API auth", detail: "Endpoints are open on the LAN; no authentication or access control." },
  { title: "Release builds", detail: "Only debug builds are signed and released; no production-signed APK." },
];

const UNTESTED = [
  { title: "Real multi-phone cluster", detail: "Only simulated on one phone (2 local nodes). Never run across real devices on Wi-Fi." },
  { title: "GPU benchmark", detail: "EGL clear-rate runs, but correctness and consistency across GPUs is unverified." },
  { title: "llama.cpp output", detail: "Inference compiles and runs; output quality and tokens/sec on real hardware not measured." },
  { title: "USB-tethered PC console", detail: "Browser console (pc/index.html) against a real phone over USB tethering not validated end-to-end." },
  { title: "Obtainium auto-update", detail: "Stable signing cert added this build; the update path hasn't been confirmed yet." },
  { title: "Long-run stability", detail: "WakeLock/WifiLock behavior, thermal throttling, and multi-hour uptime not tested." },
];

const STATUS = {
  done: { label: "Working", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  partial: { label: "Partial", cls: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  not: { label: "Not yet", cls: "bg-rose-100 text-rose-700 border-rose-200", dot: "bg-rose-400" },
  untested: { label: "Untested", cls: "bg-slate-200 text-slate-600 border-slate-300", dot: "bg-slate-400" },
};

function Card({ title, detail, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-[#dcd8cf] bg-white p-5">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 shrink-0 rounded-lg bg-[#F3F1EC] p-2 text-[#141414]">
            <Icon size={16} />
          </div>
        )}
        <div>
          <h3 className="font-mono text-[13px] font-semibold text-[#141414]">{title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#6f6b62]">{detail}</p>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDashboard() {
  const counts = WANTED.reduce((a, w) => {
    a[w.status] = (a[w.status] || 0) + 1;
    return a;
  }, {});

  return (
    <div className="space-y-10">
      <section className="rounded-3xl border border-[#dcd8cf] bg-[#F7F5F1] p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8f8b82]">Project status</span>
          <span className="font-mono text-[10px] text-[#8f8b82]">· v0.2 (testing)</span>
        </div>
        <h1 className="font-display text-4xl md:text-5xl text-[#141414] leading-tight">PhoneCluster</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#4a473f]">
          A distributed AI compute cluster built from Android phones. Each phone becomes a compute node that exposes its CPU, GPU and RAM over USB or Wi-Fi — and any phone (or PC) can orchestrate inference and compute across the whole pool.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {Object.entries(STATUS).map(([k, v]) => (
            <span key={k} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] ${v.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} /> {v.label} {counts[k] || 0}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8f8b82] mb-2">The final project</h2>
        <p className="text-[14px] leading-relaxed text-[#3a382f] max-w-3xl">
          The end goal is a self-organizing mesh of phones that behaves like a single heterogeneous computer: you hand it a prompt or a compute job, and the orchestrator splits it across whatever nodes are on the network — CPU for general work, GPU for parallel and graphics, NPU for inference, RAM pooled for larger models — with no PC required and no cloud dependency.
        </p>
      </section>

      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8f8b82] mb-3">Everything it was meant to do</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {WANTED.map((w) => {
            const s = STATUS[w.status];
            return (
              <div key={w.name} className="flex items-center justify-between gap-3 rounded-xl border border-[#e9e5dc] bg-white px-4 py-3">
                <span className="text-[13px] text-[#2a2820]">{w.name}</span>
                <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${s.cls}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-700 mb-3">What it does now</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CURRENT.map((c) => (
            <Card key={c.title} {...c} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-rose-600 mb-3">Doesn't do yet</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {NOT_YET.map((c) => (
            <Card key={c.title} {...c} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-3">Untested</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {UNTESTED.map((c) => (
            <Card key={c.title} {...c} />
          ))}
        </div>
      </section>
    </div>
  );
}