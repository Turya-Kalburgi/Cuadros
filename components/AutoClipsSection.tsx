"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AutoClipJobMeta,
  AutoClipMode,
  AutoClipPlan,
  AutoClipType,
  ExportFormat,
  MusicSearchResult,
  ReelLook,
} from "@/lib/types";
import type { SongMood } from "@/lib/song_catalog";
import { SONG_CATALOG, type CatalogSong } from "@/lib/song_list";

const STAGES = [
  { key: "downloading", label: "Downloading source video" },
  { key: "analyzing", label: "Reading scenes, dialogue & pacing" },
  { key: "planning", label: "Sampling the best shots" },
  { key: "rendering", label: "Editing clips & mixing your song" },
] as const;

const STATUS_ORDER: Record<string, number> = {
  downloading: 0,
  analyzing: 1,
  planning: 2,
  rendering: 3,
  ready: 4,
  error: -1,
};

const LENGTHS = [15, 30, 45, 60];
const SHOT_LENGTHS = [
  { id: 2, label: "2s" },
  { id: 3, label: "3s" },
  { id: 0, label: "Off" },
];
const ASPECTS: Array<{ id: ExportFormat; label: string }> = [
  { id: "vertical", label: "Vertical 9:16" },
  { id: "horizontal", label: "Horizontal 16:9" },
  { id: "fit", label: "Horizontal in vertical" },
];
const LOOKS: Array<{ id: ReelLook; label: string }> = [
  { id: "warm", label: "Warm cozy" },
  { id: "clean", label: "Clean neutral" },
  { id: "cinematic", label: "Cinematic" },
  { id: "none", label: "Original" },
];
const MODES: Array<{ id: AutoClipMode; label: string }> = [
  { id: "talking", label: "Talking reels" },
  { id: "visual", label: "Visual reels" },
  { id: "both", label: "Both" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AutoClipsSection() {
  const [url, setUrl] = useState("");
  const [length, setLength] = useState(30);
  const [editStyle, setEditStyle] = useState<"clean" | "montage">("clean");
  const [aspect, setAspect] = useState<ExportFormat>("vertical");
  const [look, setLook] = useState<ReelLook>("warm");
  const [faceMode, setFaceMode] = useState<"main" | "faceless" | "any">("main");
  const [shotLength, setShotLength] = useState(3);
  const [textOverlay, setTextOverlay] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mode, setMode] = useState<AutoClipMode>("both");
  const [resolution, setResolution] = useState(1080);
  const [musicMode, setMusicMode] = useState<"auto" | "catalog" | "url" | "none">("auto");
  const [musicMood, setMusicMood] = useState<"auto" | SongMood>("trending");
  const [licenseSafe, setLicenseSafe] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [selectedCatalogSong, setSelectedCatalogSong] = useState<CatalogSong | null>(null);
  const [musicQuery, setMusicQuery] = useState("");
  const [musicResults, setMusicResults] = useState<MusicSearchResult[]>([]);
  const [searchingMusic, setSearchingMusic] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const [musicTitle, setMusicTitle] = useState("");
  const [focus, setFocus] = useState("");
  const [rights, setRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AutoClipJobMeta | null>(null);
  const [history, setHistory] = useState<AutoClipJobMeta[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [bunny, setBunny] = useState<{ configured: boolean; zone: string | null } | null>(null);
  const [aiLabel, setAiLabel] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAudio, setCopiedAudio] = useState(false);
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{
    status: string;
    progress: number;
    detail: string;
    frames?: Array<{ index: number; time: number }>;
  } | null>(null);
  const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set());

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/autoclips");
      const data = (await res.json()) as { jobs?: AutoClipJobMeta[] };
      setHistory(data.jobs ?? []);
    } catch {
      /* optional */
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  const searchSongs = async () => {
    const q = musicQuery.trim();
    if (!q) return;
    setSearchingMusic(true);
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { results?: MusicSearchResult[] };
      setMusicResults(data.results ?? []);
    } catch {
      setMusicResults([]);
    } finally {
      setSearchingMusic(false);
    }
  };

  const copyCaption = async (clipNumber: number) => {
    if (!job) return;
    try {
      const response = await fetch(`/api/autoclips/${job.id}/clips/${clipNumber}/caption`);
      const data = (await response.json()) as { caption?: string };
      if (data.caption) {
        await navigator.clipboard.writeText(data.caption);
        setCopiedIndex(clipNumber);
        setTimeout(() => setCopiedIndex(null), 2000);
      }
    } catch {
      /* clipboard may be blocked */
    }
  };

  const loadTimeline = async () => {
    setError(null);
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
      setError("Paste a valid video link first.");
      return;
    }
    try {
      const response = await fetch("/api/autoclips/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await response.json()) as { job?: { id: string }; error?: string };
      if (!data.job) throw new Error(data.error ?? "Could not start timeline.");
      setTimelineId(data.job.id);
      setTimeline({ status: "downloading", progress: 2, detail: "Starting timeline…" });
      setSelectedFrames(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load timeline.");
    }
  };

  useEffect(() => {
    if (!timelineId || timeline?.status === "ready" || timeline?.status === "error") return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/autoclips/timeline/${timelineId}`);
        const data = (await response.json()) as { job?: typeof timeline };
        if (data.job) setTimeline(data.job);
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [timelineId, timeline?.status]);

  useEffect(() => {
    fetch("/api/bunny/status")
      .then((r) => r.json())
      .then((data) => setBunny(data as { configured: boolean; zone: string | null }))
      .catch(() => undefined);
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setAiLabel((data as { aiLabel?: string }).aiLabel ?? null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/autoclips")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setHistory((data as { jobs?: AutoClipJobMeta[] }).jobs ?? []);
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeJob = job && job.status !== "ready" && job.status !== "error" ? job : null;

  useEffect(() => {
    if (!activeJob) return;
    const id = activeJob.id;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/autoclips/${id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { job?: AutoClipJobMeta };
        if (data.job) {
          setJob(data.job);
          if (data.job.status === "ready" || data.job.status === "error") void loadHistory();
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeJob, loadHistory]);

  const start = async () => {
    setError(null);
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
      setError("Paste a valid video link (https://…).");
      return;
    }
    if (!rights) {
      setError("Confirm you have the rights to edit this video before continuing.");
      return;
    }
    if (musicMode === "url" && !/^https?:\/\/\S+$/i.test(musicUrl.trim())) {
      setError("Pick a song from search or paste a valid song URL.");
      return;
    }
    if (musicMode === "catalog" && !selectedCatalogSong) {
      setError("Choose a song from the 50-song list first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/autoclips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          timelineId: selectedFrames.size > 0 ? timelineId : null,
          selectedTimes:
            selectedFrames.size > 0
              ? (timeline?.frames ?? [])
                  .filter((frame) => selectedFrames.has(frame.index))
                  .map((frame) => frame.time)
              : [],
          targetDuration: length,
          mode,
          resolution,
          editStyle,
          aspect,
          look,
          faceMode,
          shotLength,
          textOverlay,
          focus,
          music:
            musicMode === "catalog" && selectedCatalogSong
              ? {
                  mode: "catalog",
                  title: `${selectedCatalogSong.title} — ${selectedCatalogSong.artist}`,
                  query: selectedCatalogSong.query,
                  mood: selectedCatalogSong.mood,
                  licenseSafe,
                }
              : musicMode === "auto"
                ? { mode: "auto", mood: musicMood, licenseSafe }
                : musicMode === "url"
                  ? { mode: "url", url: musicUrl.trim(), title: musicTitle || null }
                  : { mode: "none" },
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        job?: AutoClipJobMeta;
        error?: string;
      } | null;
      if (!res.ok || !data?.job) throw new Error(data?.error ?? "Could not start auto clips.");
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start auto clips.");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setJob(null);
    setError(null);
  };

  if (activeJob) {
    const stageIdx = STATUS_ORDER[activeJob.status] ?? 0;
    return (
      <section className="rounded-2xl border border-[#292929] bg-[#191919] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#F5F5F0]">Finding your best moments…</h2>
            <p className="mt-0.5 max-w-lg truncate text-xs text-[#929292]">{activeJob.url}</p>
          </div>
          <span className="rounded-full bg-[#FFC800]/15 px-3 py-1 font-mono text-xs text-[#FFC800]">
            {activeJob.progress}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#292929]">
          <div
            className="h-full bg-[#FFC800] transition-all duration-500"
            style={{ width: `${Math.max(3, Math.min(100, activeJob.progress))}%` }}
          />
        </div>
        <ol className="space-y-3">
          {STAGES.map((stage, i) => {
            const state = i < stageIdx ? "done" : i === stageIdx ? "active" : "pending";
            return (
              <li key={stage.key} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                    state === "done"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : state === "active"
                        ? "bg-[#FFC800]/20 text-[#FFC800] animate-pulse"
                        : "bg-[#292929] text-[#929292]"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={`text-sm ${
                    state === "active"
                      ? "text-[#F5F5F0]"
                      : state === "done"
                        ? "text-[#929292]"
                        : "text-[#929292]/50"
                  }`}
                >
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-[#FFC800]/90 animate-pulse">{activeJob.detail}</p>
        <p className="text-[11px] text-[#929292]">Long videos can take a few minutes to analyze and render.</p>
      </section>
    );
  }

  if (job?.status === "ready" && job.clips) {
    const plans = (job.plans ?? []) as AutoClipPlan[];
    const aiUsed = plans.some((p) => p.aiUsed);
    return (
      <div className="space-y-6">
        <section className="rounded-2xl border border-[#292929] bg-[#191919] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#F5F5F0] flex items-center gap-2">
                {job.clips.length} best clips from your video
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">
                  ready
                </span>
              </h2>
              <p className="mt-0.5 max-w-xl truncate text-xs text-[#929292]">
                {job.title || job.url}
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-[#292929] px-5 py-2 text-xs text-[#F5F5F0] hover:border-[#FFC800]/50"
            >
              New auto clips
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#929292]">
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {aiUsed ? "AI-titled reels" : "Auto-titled reels"}
            </span>
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {job.analysis?.hasSubtitles ? "dialogue transcript used" : "visual + audio cues used"}
            </span>
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {job.analysis?.hardCuts ?? 0} visual cuts detected
            </span>
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {job.targetDuration}s each · {job.resolution}p · {job.look ?? "warm"} look
            </span>
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {ASPECTS.find((a) => a.id === (job.aspect ?? "vertical"))?.label ?? "Vertical 9:16"}
            </span>
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {job.shotLength ? `${job.shotLength}s cuts · hook-first arc` : "smart cuts"} · no repeats
            </span>
            {job.music?.title && (
              <span className="rounded-full bg-[#FFC800]/10 px-2 py-0.5 text-[#FFC800]">
                ♫ {job.music.title}
              </span>
            )}
            {job.music?.fallback && (
              <span className="rounded-full bg-[#292929] px-2 py-0.5 text-[#929292]">
                built-in song (YouTube blocked)
              </span>
            )}
            {job.storage?.synced && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                ☁ Bunny synced
              </span>
            )}
          </div>
          {job.music?.suggestion && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#292929] bg-[#080808] px-3 py-2 text-[11px] text-[#929292]">
              {job.music.licenseRisk && (
                <span className="rounded-full bg-red-950/50 px-2 py-0.5 text-red-300">
                  May be muted on Instagram
                </span>
              )}
              <span className="min-w-0 flex-1">
                Attach official audio in Instagram:{" "}
                <span className="text-[#FFC800]">{job.music.suggestion}</span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(job.music?.suggestion ?? "");
                    setCopiedAudio(true);
                    setTimeout(() => setCopiedAudio(false), 2000);
                  } catch {
                    /* clipboard may be blocked */
                  }
                }}
                className="rounded-full border border-[#292929] px-2 py-1 text-[#F5F5F0] hover:border-[#FFC800]/50"
              >
                {copiedAudio ? "Copied" : "Copy audio name"}
              </button>
            </div>
          )}
        </section>

        {(["talking", "visual"] as AutoClipType[]).map((type) => {
          const clips = job.clips ?? [];
          const group = clips.filter((clip) => clip.type === type);
          if (group.length === 0) return null;
          return (
            <section key={type} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#F5F5F0]">
                  {type === "talking" ? "🗣️ Talking reels" : "🎞️ Visual reels"}
                  <span className="ml-2 text-xs font-normal text-[#929292]">
                    {group.length} reels · random highlights
                  </span>
                </h3>
                {type === "visual" && !job.music && (
                  <p className="text-[11px] text-[#929292]">Silent by design — add your own song later.</p>
                )}
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {group.map((clip) => {
                  const plan = plans[clip.index];
                  const n = clip.index + 1;
                  return (
                    <article
                      key={clip.fileName}
                      className="overflow-hidden rounded-2xl border border-[#292929] bg-[#191919]"
                    >
                        <div
                          className={`relative max-h-[420px] bg-black ${
                            (job.aspect ?? "vertical") === "horizontal" ? "aspect-video" : "aspect-[9/16]"
                          }`}
                        >
                        <video
                          src={`/api/autoclips/${job.id}/clips/${n}/video`}
                          poster={`/api/autoclips/${job.id}/clips/${n}/thumb`}
                          controls
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-contain"
                        />
                      </div>
                      {clip.storyboard && (
                        <div
                          className="h-24 w-full border-b border-[#292929] bg-cover bg-center"
                          style={{
                            backgroundImage: `url(/api/autoclips/${job.id}/clips/${n}/storyboard)`,
                          }}
                          aria-label="Storyboard preview"
                        />
                      )}
                      <div className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-[#F5F5F0]">{clip.title}</h4>
                          <span className="shrink-0 rounded-full bg-[#292929] px-2 py-0.5 font-mono text-[10px] text-[#929292]">
                            {clip.durationSeconds.toFixed(1)}s
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-[#929292]">{clip.reason}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(plan?.keywords ?? []).map((kw) => (
                            <span
                              key={kw}
                              className="rounded-full bg-[#FFC800]/10 px-2 py-0.5 text-[10px] text-[#FFC800]"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center justify-between border-t border-[#292929] pt-3 text-[11px] text-[#929292]">
                          <span>
                            {clip.rangeCount} {job.shotLength ? `${job.shotLength}s shots` : "smart cuts"} ·{" "}
                            {job.resolution}p
                          </span>
                          <button
                            type="button"
                            onClick={() => void copyCaption(n)}
                            className="rounded-full border border-[#292929] px-3 py-1.5 text-[#F5F5F0] hover:border-[#FFC800]/50"
                          >
                            {copiedIndex === n ? "Copied" : "Copy caption"}
                          </button>
                          {clip.cdnUrl && (
                            <a
                              href={clip.cdnUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-[#292929] px-3 py-1.5 text-[#F5F5F0] hover:border-[#FFC800]/50"
                            >
                              CDN ↗
                            </a>
                          )}
                          <a
                            href={`/api/autoclips/${job.id}/clips/${n}/video`}
                            download={`cuadros-${type}-${clip.sequence}.mp4`}
                            className="rounded-full bg-[#FFC800] px-3 py-1.5 font-semibold text-black hover:bg-[#D99A00]"
                          >
                            ⬇ Download
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        {plans.length > 0 && (
          <section className="rounded-2xl border border-[#292929] bg-[#191919]/60 p-5">
            <p className="text-sm font-medium text-[#F5F5F0]">Why these moments</p>
            <ul className="mt-3 space-y-2">
              {plans.map((plan) => (
                <li
                  key={plan.index}
                  className="rounded-lg border border-[#292929] bg-[#080808]/60 px-3 py-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-[#F5F5F0]">{plan.title}</span>
                    <span className="font-mono text-[10px] text-[#929292]">
                      {plan.ranges.length} cuts · score {plan.score}
                    </span>
                  </div>
                  <p className="mt-1 text-[#929292]">{plan.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  const jobError = job?.status === "error" ? (job.error ?? job.detail) : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#292929] bg-[#191919] p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-[#F5F5F0] flex items-center gap-2">
            🧠 Auto AI Clips
            <span className="rounded-full bg-[#FFC800]/15 px-2.5 py-0.5 text-[10px] font-mono text-[#FFC800]">
              BETA
            </span>
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#929292]">
            Paste a long video link. cuadros samples the best 2–3 second shots from across the whole
            video and builds 5 fast-cut reels with a song — like a highlight reel. No sequence, just
            the strongest moments. Choose             your aspect ratio and music.
          </p>
          <p className="mt-1 text-[11px] text-[#929292]">
            Storage: {bunny?.configured ? `Bunny · ${bunny.zone}` : "local disk (add BUNNY_* keys in .env.local)"}
          </p>
          <p className="mt-1 text-[11px] text-[#929292]">
            AI: {aiLabel ?? "checking…"} · add OPENAI_API_KEY or GEMINI_API_KEY in .env.local for
            smarter titles and hooks.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-[#F5F5F0]">Video link</span>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTimeline(null);
              setTimelineId(null);
              setSelectedFrames(new Set());
            }}
            placeholder="https://youtube.com/watch?v=…"
            className="mt-1.5 w-full rounded-full border border-[#292929] bg-[#080808] px-4 py-2.5 text-sm text-[#F5F5F0] placeholder:text-[#929292]/60 focus:border-[#FFC800]/60 focus:outline-none"
          />
        </label>

        <div className="space-y-2 rounded-xl border border-[#292929] bg-[#080808] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#F5F5F0]">Pick exact frames</span>
            <button
              type="button"
              onClick={() => void loadTimeline()}
              className="rounded-full border border-[#292929] px-4 py-1.5 text-xs text-[#F5F5F0] hover:border-[#FFC800]/50"
            >
              Load timeline
            </button>
          </div>
          {timeline && timeline.status !== "ready" && timeline.status !== "error" && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-[#292929]">
                <div
                  className="h-full bg-[#FFC800] transition-all"
                  style={{ width: `${Math.max(3, timeline.progress)}%` }}
                />
              </div>
              <p className="text-[11px] text-[#FFC800]">{timeline.detail}</p>
            </div>
          )}
          {timeline?.status === "error" && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
              {timeline.detail || "Timeline failed."}
              <button
                type="button"
                onClick={() => void loadTimeline()}
                className="ml-2 underline hover:text-red-100"
              >
                Retry
              </button>
            </div>
          )}
          {timeline?.status === "ready" && timeline.frames && (
            <>
              <p className="text-[11px] text-[#929292]">
                {timeline.frames.length} frames — tap the ones you want. Each pick becomes a reel.
              </p>
              <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
                {timeline.frames.map((frame) => {
                  const active = selectedFrames.has(frame.index);
                  return (
                    <button
                      key={frame.index}
                      type="button"
                      onClick={() => {
                        setSelectedFrames((current) => {
                          const next = new Set(current);
                          if (next.has(frame.index)) next.delete(frame.index);
                          else next.add(frame.index);
                          return next;
                        });
                      }}
                      className={`relative overflow-hidden rounded border ${
                        active ? "border-[#FFC800] ring-2 ring-[#FFC800]/50" : "border-[#292929]"
                      }`}
                      title={`${Math.round(frame.time)}s`}
                    >
                      <div
                        className="aspect-video w-full bg-cover bg-center"
                        style={{
                          backgroundImage: `url(/api/autoclips/timeline/${timelineId}/frames/${frame.index})`,
                        }}
                      />
                      <span className="absolute bottom-0 left-0 w-full bg-black/70 text-center font-mono text-[9px] text-[#FFC800]">
                        {Math.round(frame.time)}s
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedFrames.size > 0 && (
                <p className="text-[11px] text-[#FFC800]">
                  {selectedFrames.size} frame{selectedFrames.size > 1 ? "s" : ""} selected — press
                  Build to make {selectedFrames.size} reel{selectedFrames.size > 1 ? "s" : ""}.
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Style</span>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {(
              [
                { id: "clean", label: "Clean single shot" },
                { id: "montage", label: "Fast cuts" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setEditStyle(option.id)}
                className={`rounded-lg border px-3 py-2 text-xs transition-all ${
                  editStyle === option.id
                    ? "border-[#FFC800] bg-[#FFC800]/10 font-medium text-[#FFC800]"
                    : "border-[#292929] bg-[#080808] text-[#929292] hover:border-[#FFC800]/40"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#929292]">
            Clean copies the feel of your reference reel: one calm ~20s shot with a song.
          </p>
        </div>

        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Aspect ratio</span>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            {ASPECTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAspect(option.id)}
                className={`rounded-lg border px-3 py-2 text-xs transition-all ${
                  aspect === option.id
                    ? "border-[#FFC800] bg-[#FFC800]/10 font-medium text-[#FFC800]"
                    : "border-[#292929] bg-[#080808] text-[#929292] hover:border-[#FFC800]/40"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#929292]">
            Horizontal in vertical keeps the full landscape frame inside a 9:16 canvas.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          className="text-[11px] text-[#929292] underline underline-offset-2 hover:text-[#FFC800]"
        >
          {showAdvanced ? "Hide fine-tuning" : "Fine-tuning (optional)"}
        </button>
        {showAdvanced && (
          <>
        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Look</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {LOOKS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLook(option.id)}
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                  look === option.id
                    ? "bg-[#FFC800] font-semibold text-black"
                    : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Faces</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(
              [
                { id: "main", label: "Only me" },
                { id: "faceless", label: "Faceless" },
                { id: "any", label: "Anyone" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFaceMode(option.id)}
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                  faceMode === option.id
                    ? "bg-[#FFC800] font-semibold text-black"
                    : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#929292]">
            Rejects other people and phones. Only me keeps just your face; faceless keeps hands and spaces.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-[#F5F5F0]">
            What should the clips focus on? <span className="text-[#929292]">(optional)</span>
          </span>
          <input
            type="text"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="e.g. the troubleshooting part, the recipe, the interview highlight"
            className="mt-1.5 w-full rounded-xl border border-[#292929] bg-[#080808] px-3 py-2 text-xs text-[#F5F5F0] placeholder:text-[#929292]/60 focus:border-[#FFC800]/60 focus:outline-none"
          />
        </label>

        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Reel type</span>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMode(option.id)}
                className={`rounded-lg border px-3 py-2 text-xs transition-all ${
                  mode === option.id
                    ? "border-[#FFC800] bg-[#FFC800]/10 font-medium text-[#FFC800]"
                    : "border-[#292929] bg-[#080808] text-[#929292] hover:border-[#FFC800]/40"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#929292]">
            Talking reels keep dialogue; visual reels use the look of the shots. With a song selected,
            the music becomes the soundtrack.
          </p>
        </div>

        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Shot length</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {SHOT_LENGTHS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setShotLength(option.id)}
                className={`rounded-full px-4 py-1.5 text-xs transition-colors ${
                  shotLength === option.id
                    ? "bg-[#FFC800] font-semibold text-black"
                    : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#929292]">
            Each reel uses different short shots arranged through the day. Off uses longer smart cuts.
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#929292]">
          <input
            type="checkbox"
            checked={textOverlay}
            onChange={(e) => setTextOverlay(e.target.checked)}
            className="h-4 w-4 shrink-0 accent-[#FFC800]"
          />
          <span>Burn minimal on-screen text (hook line + timestamps)</span>
        </label>
          </>
        )}

        <div className="space-y-3 rounded-xl border border-[#292929] bg-[#080808] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#F5F5F0]">Music</span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "auto", label: "Auto song" },
                  { id: "catalog", label: "50 song list" },
                  { id: "url", label: "Paste URL" },
                  { id: "none", label: "No music" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setMusicMode(option.id)}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                    musicMode === option.id
                      ? "bg-[#FFC800] font-semibold text-black"
                      : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-[#929292]/70">
            Manual picks teach Auto song what to choose for similar clips.
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-[#929292]">
            <input
              type="checkbox"
              checked={licenseSafe}
              onChange={(e) => setLicenseSafe(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#FFC800]"
            />
            <span>License-safe export: use built-in audio, attach the suggested trending sound inside Instagram.</span>
          </label>
          {musicMode === "auto" && (
            <div className="space-y-2">
              <p className="text-[11px] text-[#929292]">
                cuadros picks a trending track from a 50-song chart list, then builds each reel around
                the song energy — calm intro, build, peak, resolve — and locks cuts to the beat.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {                (["trending", "cinematic", "cozy", "auto"] as const).map((mood) => (
                  <button
                    key={mood}
                    type="button"
                    onClick={() => setMusicMood(mood)}
                    className={`rounded-full px-3 py-1 text-[11px] capitalize transition-colors ${
                      musicMood === mood
                        ? "bg-[#FFC800] font-semibold text-black"
                        : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                    }`}
                  >
                    {mood}
                  </button>
                ))}
              </div>
            </div>
          )}
          {musicMode === "catalog" && (
            <div className="space-y-2">
              <input
                type="text"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="Search 50 songs: love me not, stan, routine, coffee…"
                className="w-full rounded-xl border border-[#292929] bg-[#191919] px-3 py-2 text-xs text-[#F5F5F0] placeholder:text-[#929292]/60 focus:border-[#FFC800]/60 focus:outline-none"
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {SONG_CATALOG.filter((song) => {
                  const q = catalogQuery.trim().toLowerCase();
                  if (!q) return true;
                  return `${song.title} ${song.artist} ${song.use} ${song.keywords.join(" ")}`
                    .toLowerCase()
                    .includes(q);
                })
                  .slice(0, 14)
                  .map((song) => (
                    <button
                      key={`${song.title}-${song.artist}`}
                      type="button"
                      onClick={() => setSelectedCatalogSong(song)}
                      className={`flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                        selectedCatalogSong?.title === song.title
                          ? "border-[#FFC800] bg-[#FFC800]/10 text-[#FFC800]"
                          : "border-[#292929] text-[#929292] hover:border-[#FFC800]/40"
                      }`}
                    >
                      <span className="text-xs font-medium">
                        {song.title} — {song.artist}
                      </span>
                      <span className="text-[10px] opacity-80">{song.use}</span>
                    </button>
                  ))}
              </div>
              {selectedCatalogSong && (
                <p className="truncate text-[11px] text-[#FFC800]">
                  Selected: {selectedCatalogSong.title} — {selectedCatalogSong.artist} ·{" "}
                  {selectedCatalogSong.arc} arc
                </p>
              )}
            </div>
          )}
          {musicMode === "url" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={musicQuery}
                  onChange={(e) => setMusicQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void searchSongs();
                    }
                  }}
                  placeholder="Search songs, e.g. cinematic hype"
                  className="min-w-0 flex-1 rounded-xl border border-[#292929] bg-[#191919] px-3 py-2 text-xs text-[#F5F5F0] placeholder:text-[#929292]/60 focus:border-[#FFC800]/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void searchSongs()}
                  disabled={searchingMusic || !musicQuery.trim()}
                  className="shrink-0 rounded-full border border-[#292929] px-4 py-2 text-xs text-[#F5F5F0] hover:border-[#FFC800]/50 disabled:opacity-50"
                >
                  {searchingMusic ? "Searching…" : "Search"}
                </button>
              </div>
              {musicResults.length > 0 && (
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {musicResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => {
                        setMusicUrl(result.url);
                        setMusicTitle(result.title);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${
                        musicUrl === result.url
                          ? "border-[#FFC800] bg-[#FFC800]/10 text-[#FFC800]"
                          : "border-[#292929] text-[#929292] hover:border-[#FFC800]/40"
                      }`}
                    >
                      <span className="min-w-0 truncate">{result.title}</span>
                      <span className="shrink-0 font-mono">{result.duration ? `${Math.round(result.duration)}s` : "—"}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                type="url"
                value={musicUrl}
                onChange={(e) => {
                  setMusicUrl(e.target.value);
                  setMusicTitle("");
                }}
                placeholder="…or paste a song URL"
                className="w-full rounded-xl border border-[#292929] bg-[#191919] px-3 py-2 text-xs text-[#F5F5F0] placeholder:text-[#929292]/60 focus:border-[#FFC800]/60 focus:outline-none"
              />
              {musicTitle && (
                <p className="truncate text-[11px] text-[#FFC800]">Selected: {musicTitle}</p>
              )}
            </div>
          )}
        </div>

        {showAdvanced && (
          <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="text-xs font-medium text-[#F5F5F0]">Clip length</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {LENGTHS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setLength(d)}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    length === d
                      ? "bg-[#FFC800] font-semibold text-black"
                      : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                  }`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-[#F5F5F0]">Output resolution</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {[720, 1080].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResolution(r)}
                  className={`rounded-full px-4 py-1.5 text-xs transition-colors ${
                    resolution === r
                      ? "bg-[#FFC800] font-semibold text-black"
                      : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                  }`}
                >
                  {r}p
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-[#929292]">
          cuadros scans the full video and delivers the 5 best clips only.
        </p>
          </>
        )}

        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[#292929] bg-[#080808] px-4 py-3 text-xs text-[#929292]">
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#FFC800]"
          />
          <span>I have the rights to download and edit this video and its audio.</span>
        </label>

        {(error || jobError) && (
          <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error ?? jobError}
            {jobError && (
              <button
                type="button"
                onClick={reset}
                className="ml-3 text-red-200/80 underline hover:text-red-100"
              >
                Try again
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void start()}
          disabled={submitting || !url.trim() || !rights}
          className="w-full rounded-full bg-[#FFC800] px-8 py-3 text-sm font-semibold text-black shadow-md transition-all hover:bg-[#D99A00] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {submitting ? "Starting…" : "🧠 Build my reel stacks"}
        </button>
      </section>

      {historyLoaded && history.length > 0 && (
        <section className="rounded-2xl border border-[#292929] bg-[#191919]/60 p-5">
          <p className="text-sm font-medium text-[#F5F5F0]">Recent auto-clip jobs</p>
          <ul className="mt-3 grid gap-2">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setJob(h);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border border-[#292929] bg-[#080808]/60 px-3 py-2 text-left transition-colors hover:border-[#FFC800]/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[#F5F5F0]">
                      {h.title || h.url}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#929292]">
                      {h.targetDuration}s × {h.clips?.length ?? h.clipCount} · {h.resolution ?? 1080}p ·{" "}
                      {ASPECTS.find((a) => a.id === (h.aspect ?? "vertical"))?.label ?? "Vertical 9:16"} ·{" "}
                      {h.mode ?? "both"} · {fmtDate(h.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[#292929] px-2 py-0.5 text-[10px] text-[#929292]">
                    {h.status === "ready" ? "ready" : h.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
