import { useEffect, useMemo, useState } from "react";
import {
  WandSparkles,
  Layers,
  Sofa,
  Eraser,
  Hammer,
  Sun,
  Sparkles,
  Video,
  Upload,
  Loader2,
  AlertTriangle,
  Download,
  CornerUpLeft,
  ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { api, type Tool, type Render } from "./api";

const ICONS: Record<string, LucideIcon> = {
  "wand-sparkles": WandSparkles,
  layers: Layers,
  sofa: Sofa,
  eraser: Eraser,
  hammer: Hammer,
  sun: Sun,
  sparkles: Sparkles,
  video: Video,
};

const CATEGORY_ORDER = ["concept", "surfaces", "staging", "lighting", "polish"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  concept: "Concept",
  surfaces: "Surfaces",
  staging: "Staging",
  lighting: "Lighting",
  polish: "Polish",
};

/** What's currently shown big in the canvas. */
type Selected = { url: string; kind: "source" | "render"; label: string; sub?: string; disclaimer?: string | null };

export function App() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [health, setHealth] = useState<{ openrouter: boolean; fal: boolean } | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [renders, setRenders] = useState<Render[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [active, setActive] = useState<Tool | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listTools().then(setTools).catch(() => {});
    api.health().then(setHealth).catch(() => {});
  }, []);

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({ cat, items: tools.filter((t) => t.category === cat) })).filter((g) => g.items.length);
  }, [tools]);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const url = await api.upload(file);
      setSource(url);
      setSelected({ url, kind: "source", label: "Source" });
    } finally {
      setUploading(false);
    }
  }

  function openTool(tool: Tool) {
    const init: Record<string, string> = {};
    for (const i of tool.inputs) if (i.type === "select" && i.options?.length) init[i.name] = i.options[0];
    setParams(init);
    setActive(tool);
  }

  async function runTool() {
    if (!active || !selected) return;
    const tool = active;
    const sub = summarizeParams(params);
    setBusy(true);
    const usingUrl = selected.url; // edits chain off whatever's in the canvas
    try {
      const r = await api.render({ tool_id: tool.id, source_image_url: usingUrl, params });
      setRenders((prev) => [r, ...prev]);
      if (r.status === "pending") {
        // Async video — kicked off, poll until it lands.
        pollRender(r.id, tool.label, sub);
      } else if (r.status !== "error" && (r.result_image_url || r.result_video_url)) {
        setSelected({ url: r.result_image_url || r.result_video_url!, kind: "render", label: tool.label, sub, disclaimer: r.disclaimer });
      }
      setActive(null);
    } catch (e) {
      setRenders((prev) => [errRender(tool.id, usingUrl, e), ...prev]);
      setActive(null);
    } finally {
      setBusy(false);
    }
  }

  // Poll a pending (video) render every 5s until it resolves (~7.5 min cap).
  function pollRender(id: string, label: string, sub: string) {
    let attempts = 0;
    const tick = async () => {
      attempts++;
      try {
        const r = await api.getRender(id);
        setRenders((prev) => prev.map((x) => (x.id === id ? r : x)));
        if (r.status === "pending" && attempts < 90) {
          setTimeout(tick, 5000);
        } else if (r.status === "done" && r.result_video_url) {
          setSelected({ url: r.result_video_url, kind: "render", label, sub, disclaimer: r.disclaimer });
        }
      } catch {
        if (attempts < 90) setTimeout(tick, 5000);
      }
    };
    setTimeout(tick, 5000);
  }

  const canRun = active?.inputs.every((i) => !i.required || (params[i.name] || "").trim().length > 0) ?? false;
  const strip = [
    ...(source ? [{ key: "src", status: "source" as const, url: source, isVideo: false, label: "Source", disclaimer: null as string | null }] : []),
    ...renders.map((r) => ({
      key: r.id,
      status: (r.status === "error" ? "error" : r.status === "pending" ? "pending" : "done") as "error" | "pending" | "done",
      url: r.result_image_url || r.result_video_url || undefined,
      isVideo: !!r.result_video_url,
      label: tools.find((t) => t.id === r.tool_id)?.label ?? r.tool_id,
      disclaimer: r.disclaimer,
    })),
  ];
  const selectedIsVideo = !!selected && /\.mp4($|\?)/.test(selected.url);

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="h-14 shrink-0 border-b border-border bg-card flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="app-icon size-7">
            <ImageIcon size={16} />
          </span>
          <span className="text-[0.9375rem] font-semibold">OpenRenderStudio</span>
        </div>
        <div className="flex items-center gap-3">
          {/* A key that is set is a fact, not a signal: a quiet chip. A missing
              one is what stops a render, so it reads as a warning badge. */}
          {health && (
            health.openrouter ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Key connected</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning">Key not set</span>
            )
          )}
          {/* The one ink action on this screen. */}
          <label className="btn btn-primary cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {source ? "Replace" : "Upload room"}
          </label>
        </div>
      </header>

      {/* Workspace: canvas + tools rail */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_300px]">
        {/* Canvas */}
        <section className="min-h-0 flex flex-col bg-muted">
          <div className="flex-1 min-h-0 flex items-center justify-center p-6">
            {!selected ? (
              <label className="cursor-pointer w-full max-w-xl rounded-md border border-dashed border-border bg-card flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground transition-colors hover:border-accent">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                <span className="text-sm">{uploading ? "Uploading…" : "Upload a room photo or CAD render to begin"}</span>
              </label>
            ) : (
              <div className="relative max-h-full max-w-full">
                {/* pills */}
                <div className="absolute top-3 left-3 z-10 flex gap-2">
                  <span className="over-image font-medium">{selected.label}</span>
                  {selected.sub && <span className="over-image text-muted-foreground">{selected.sub}</span>}
                </div>
                {selectedIsVideo ? (
                  <video src={selected.url} controls className="max-h-[70vh] max-w-full rounded-md shadow-float" />
                ) : (
                  <img src={selected.url} alt={selected.label} className="max-h-[70vh] max-w-full rounded-md object-contain shadow-float" />
                )}
                {busy && (
                  <div className="absolute inset-0 rounded-md bg-black/40 flex items-center justify-center text-white gap-2 text-sm">
                    <Loader2 className="animate-spin" size={18} /> Rendering…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action bar + thumbnail strip */}
          {selected && (
            <div className="shrink-0 border-t border-border bg-card">
              {selected.disclaimer && (
                <div className="px-4 pt-2 text-xs text-faint flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {selected.disclaimer}
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2">
                <a href={selected.url} download className="btn btn-secondary">
                  <Download size={16} /> Download
                </a>
                {selected.kind === "render" && !selectedIsVideo && (
                  <button
                    onClick={() => setSource(selected.url)}
                    className="btn btn-secondary"
                    title="Continue editing from this variant"
                  >
                    <CornerUpLeft size={16} /> Use as source
                  </button>
                )}
                {source && selected.url !== source && (
                  <span className="text-xs text-faint ml-1">editing from {selected.url === source ? "source" : selected.kind === "source" ? "source" : "this variant"}</span>
                )}
                {/* thumbnails */}
                <div className="ml-auto flex items-center gap-2 overflow-x-auto max-w-full sm:max-w-[60%]">
                  {strip.map((t) => {
                    const isSel = !!t.url && selected.url === t.url;
                    const cls = `shrink-0 size-12 overflow-hidden rounded-sm transition-shadow ${
                      isSel ? "shadow-[inset_0_0_0_2px_var(--color-accent)]" : "shadow-edge"
                    }`;
                    if (t.status === "pending") {
                      return (
                        <div key={t.key} className={`${cls} bg-muted flex items-center justify-center`} title={`${t.label} — rendering…`}>
                          <Loader2 size={16} className="animate-spin text-muted-foreground" />
                        </div>
                      );
                    }
                    if (t.status === "error" || !t.url) {
                      return (
                        <div key={t.key} className={`${cls} bg-muted flex items-center justify-center`} title={`${t.label} — failed`}>
                          <AlertTriangle size={15} className="text-destructive" />
                        </div>
                      );
                    }
                    return (
                      <button
                        key={t.key}
                        onClick={() => setSelected({ url: t.url!, kind: t.status === "source" ? "source" : "render", label: t.label, disclaimer: t.disclaimer })}
                        className={cls}
                        title={t.label}
                      >
                        {t.isVideo ? (
                          <div className="size-full bg-muted flex items-center justify-center"><Video size={16} className="text-muted-foreground" /></div>
                        ) : (
                          <img src={t.url} alt={t.label} className="size-full object-cover" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Tools rail */}
        <aside className="min-h-0 border-t lg:border-t-0 lg:border-l border-border bg-card overflow-y-auto">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="card-title">Directed edits</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Applied to the image in the canvas.</p>
          </div>
          {grouped.map(({ cat, items }) => (
            <div key={cat} className="px-2 py-2">
              <p className="px-2 pb-0.5 pt-1 text-[0.8125rem] font-medium text-muted-foreground">{CATEGORY_LABEL[cat]}</p>
              {items.map((tool) => {
                const Icon = ICONS[tool.icon] ?? Sparkles;
                const disabled = !selected;
                return (
                  <button
                    key={tool.id}
                    disabled={disabled}
                    onClick={() => openTool(tool)}
                    title={tool.description}
                    className="w-full flex items-start gap-2.5 rounded-sm px-2 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{tool.label}</span>
                      <span className="block text-xs text-muted-foreground line-clamp-1">{tool.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>
      </div>

      {/* Param panel */}
      {active && (
        <div className="fixed inset-0 overflow-y-auto bg-black/30" onClick={() => !busy && setActive(null)}>
          <div className="flex min-h-full items-end justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center">
          <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              {(() => {
                const Icon = ICONS[active.icon] ?? Sparkles;
                return <Icon size={16} className="text-muted-foreground" />;
              })()}
              <h3 className="card-title">{active.label}</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{active.description}</p>

            <div className="mt-4 space-y-3">
              {active.inputs.map((input) => (
                <div key={input.name}>
                  <label className="text-[0.8125rem] font-medium text-muted-foreground">{input.label}</label>
                  {input.type === "select" ? (
                    <select
                      className="input mt-1 text-sm"
                      value={params[input.name] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [input.name]: e.target.value }))}
                    >
                      {input.options?.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input mt-1 text-sm"
                      placeholder={input.placeholder}
                      value={params[input.name] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [input.name]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              {active.inputs.length === 0 && <p className="text-sm text-muted-foreground">No options — just run it.</p>}
            </div>

            {active.disclaimer && (
              <p className="mt-3 text-xs text-faint flex gap-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {active.disclaimer}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => !busy && setActive(null)}>Cancel</button>
              <button
                disabled={!canRun || busy}
                onClick={runTool}
                className="btn btn-primary"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy ? "Rendering…" : "Run"}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

function summarizeParams(params: Record<string, string>): string {
  return Object.values(params).filter(Boolean).join(" · ");
}

function errRender(toolId: string, sourceUrl: string, e: unknown): Render {
  return {
    id: `err_${Date.now()}`,
    tool_id: toolId,
    source_image_url: sourceUrl,
    params: "{}",
    prompt: "",
    result_image_url: null,
    result_video_url: null,
    status: "error",
    error: e instanceof Error ? e.message : String(e),
    disclaimer: null,
    created_at: "",
  };
}
