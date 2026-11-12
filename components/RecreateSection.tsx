"use client";

import { useCallback, useEffect, useState } from "react";
import type { LibraryClip, RecreateJobMeta } from "@/lib/types";

const STAGES = [
  { key: "downloading", label: "Fetching reference reel" },
  { key: "analyzing", label: "Reading the reel's DNA" },
  { key: "planning", label: "Matching your clips + writing captions" },
  { key: "rendering", label: "Rendering your recreation" },
] as const;

const STATUS_ORDER: Record<string, number> = {
  downloading: 0,
  analyzing: 1,
  planning: 2,
  rendering: 3,
  ready: 4,
  error: -1,
};

const DURATIONS = [15, 20, 30, 45, 60];

function fmtJobDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  clips: LibraryClip[];
  selectedIds: ReadonlySet<string>;
  onGoLibrary: () => void;
};

export default function RecreateSection({ clips, selectedIds, onGoLibrary }: Props) {
  const [refUrl, setRefUrl] = useState("");
  const [targetDuration, setTargetDuration] = useState(30);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<RecreateJobMeta | null>(null);
  const [history, setHistory] = useState<RecreateJobMeta[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/recreate");
      const data = (await res.json()) as { jobs?: RecreateJobMeta[] };
      setHistory(data.jobs ?? []);
      setHistoryLoaded(true);
    } catch {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recreate")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setHistory((data as { jobs?: RecreateJobMeta[] }).jobs ?? []);
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeJob =
    job && job.status !== "ready" && job.status !== "error" ? job : null;

  useEffect(() => {
    if (!activeJob) return;
    const jobId = activeJob.id;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/recreate/${jobId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { job?: RecreateJobMeta };
        if (data.job) {
          setJob(data.job);
          if (data.job.status === "ready" || data.job.status === "error") {
            void loadHistory();
          }
        }
      } catch {
        /* transient poll failure — keep polling */
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeJob, loadHistory]);

  const selectedClips = clips.filter((c) => selectedIds.has(c.id));
  const usableClips =
    selectedClips.length > 0 ? selectedClips : clips;

  const start = async () => {
    setError(null);
    if (!refUrl.trim()) {
      setError("Paste the link of the reel you want to recreate.");
      return;
    }
    if (usableClips.length === 0) {
      setError("Add clips to your library first — the AI needs your footage.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/recreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceUrl: refUrl.trim(),
          targetDuration,
          libraryClipIds: usableClips.map((c) => c.id),
          includeCaptions,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        job?: RecreateJobMeta;
        error?: string;
      } | null;
      if (!res.ok || !data?.job) {
        throw new Error(data?.error ?? "Could not start recreation.");
      }
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start recreation.");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setJob(null);
    setError(null);
    setRefUrl("");
  };

  const openHistoryJob = (j: RecreateJobMeta) => {
    setError(null);
    setJob(j);
  };

  // ------------------------------------------------------------------ form
  if (!job || job.status === "error") {
    const jobError = job?.status === "error" ? (job.error ?? job.detail) : null;
    return (
      <div className="space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              ✨ AI Reel Recreation
              <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs text-amber-300">
                beta
              </span>
            </h2>
            <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
              Saw a trending reel you want to recreate? Paste the link. Our AI studies its hook,
              pacing and structure — then builds a brand-new reel from <em>your</em> library clips,
              with captions and the same trending audio.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">Reel link to recreate</label>
            <div className="flex gap-2">
              <input
                type="url"
                inputMode="url"
                value={refUrl}
                onChange={(e) => setRefUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void start();
                  }
                }}
                placeholder="https://www.instagram.com/reel/…  ·  TikTok  ·  YouTube Shorts"
                className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">Reel length</label>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setTargetDuration(d)}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                    targetDuration === d
                      ? "bg-amber-500 text-black"
                      : "border border-zinc-700 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={includeCaptions}
            onClick={() => setIncludeCaptions((v) => !v)}
            className="flex w-full items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-left transition-colors hover:border-zinc-700"
          >
            <span className="text-xs">
              <span className="font-medium text-zinc-300">Captions</span>
              <span className="mt-0.5 block text-zinc-500">
                {includeCaptions
                  ? "Burned into the video + downloadable SRT file."
                  : "No captions burned in — clean video only."}
              </span>
            </span>
            <span
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                includeCaptions ? "bg-amber-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                  includeCaptions ? "left-[18px]" : "left-0.5"
                }`}
              />
            </span>
          </button>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <p className="text-zinc-300 font-medium">
                Footage pool:{" "}
                {selectedClips.length > 0 ? (
                  <span className="text-amber-300">
                    {selectedClips.length} selected clip{selectedClips.length === 1 ? "" : "s"}
                  </span>
                ) : clips.length > 0 ? (
                  <span className="text-amber-300">all {clips.length} library clips</span>
                ) : (
                  <span className="text-red-400">library is empty</span>
                )}
              </p>
              <p className="text-zinc-500 mt-0.5">
                {selectedClips.length > 0
                  ? "The AI will pick the best match for each shot."
                  : clips.length > 0
                    ? "Tip: select specific clips in the Library tab for tighter control."
                    : "Add your best clips in the Library tab first."}
              </p>
            </div>
            <button
              type="button"
              onClick={onGoLibrary}
              className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
            >
              Open Library
            </button>
          </div>

          {(error || jobError) && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error ?? jobError}
              {jobError && (
                <button
                  type="button"
                  onClick={() => setJob(null)}
                  className="ml-3 underline text-red-200/80 hover:text-red-100"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void start()}
            disabled={submitting || clips.length === 0}
            className="w-full sm:w-auto rounded-full bg-amber-500 px-8 py-3 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all"
          >
            {submitting ? "Starting…" : "🎬 AI Recreate This Reel"}
          </button>
        </section>

        {historyLoaded && history.length > 0 && (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <p className="text-sm font-medium text-zinc-300">Recent recreations</p>
            <ul className="mt-3 grid gap-2">
              {history.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => openHistoryJob(j)}
                    className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-left transition-colors hover:border-amber-500/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-zinc-200">
                        {j.referenceTitle || j.referenceUrl}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-zinc-600">
                        {j.targetDuration}s · {fmtJobDate(j.createdAt)}
                        {j.result ? ` · ${j.result.shotsCount} shots` : ""}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                        j.status === "ready"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : j.status === "error"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {j.status === "ready" ? "ready" : j.status}
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

  // -------------------------------------------------------------- progress
  if (activeJob) {
    const stageIdx = STATUS_ORDER[activeJob.status] ?? 0;
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Recreating your reel…</h2>
            <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-md">
              {activeJob.referenceTitle || activeJob.referenceUrl}
            </p>
          </div>
          <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-mono text-amber-300">
            {activeJob.progress}%
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-amber-400 transition-all duration-500"
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
                        ? "bg-amber-500/20 text-amber-300 animate-pulse"
                        : "bg-zinc-800 text-zinc-600"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={`text-sm ${
                    state === "active"
                      ? "text-zinc-100"
                      : state === "done"
                        ? "text-zinc-400"
                        : "text-zinc-600"
                  }`}
                >
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-amber-300/90 animate-pulse">{activeJob.detail}</p>

        <p className="text-[11px] text-zinc-600">
          Keep this tab open — the reel usually takes 1–3 minutes.
        </p>
      </section>
    );
  }

  // ----------------------------------------------------------------- ready
  const readyJob = job;
  const analysis = readyJob.analysis;
  const plan = readyJob.plan;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              Your recreated reel
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">
                ready
              </span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {readyJob.referenceTitle || readyJob.referenceUrl} ·{" "}
              {readyJob.result ? `${readyJob.result.durationSeconds.toFixed(1)}s` : `${readyJob.targetDuration}s`}
              {readyJob.result ? ` · ${readyJob.result.shotsCount} shots` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={`/api/recreate/${readyJob.id}/video`}
              download="cuadros-reel.mp4"
              className="rounded-full bg-[#FFC800] px-5 py-2 text-xs font-semibold text-black hover:bg-[#D99A00] transition-colors"
            >
              ⬇ Download
            </a>
            {readyJob.includeCaptions !== false &&
              plan &&
              plan.shots.some((s) => s.captionText.trim()) && (
                <a
                  href={`/api/recreate/${readyJob.id}/srt`}
                  download="cuadros-reel.srt"
                  className="rounded-full border border-zinc-700 px-4 py-2 text-xs text-zinc-300 hover:border-zinc-500"
                  title="Download captions as SRT"
                >
                  CC · SRT
                </a>
              )}
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-zinc-700 px-5 py-2 text-xs text-zinc-300 hover:border-zinc-500"
            >
              New recreation
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
          <video
            key={readyJob.id}
            src={`/api/recreate/${readyJob.id}/video`}
            controls
            playsInline
            className="mx-auto max-h-[70vh] w-full"
          />
        </div>

        {analysis && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">Hook strategy</p>
              <p className="mt-1 text-xs text-zinc-300 leading-relaxed">{analysis.hook}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">Vibe & look</p>
              <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                {analysis.vibe} · {analysis.colorMood} · captions {analysis.captionStyle.energy} at{" "}
                {analysis.captionStyle.position}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span
            className={`rounded-full px-2 py-0.5 ${
              (plan?.aiUsed ?? false)
                ? "bg-amber-400/15 text-amber-300"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {(plan?.aiUsed ?? false) ? "AI-authored plan" : "Heuristic plan (set an AI key for smarter picks)"}
          </span>
          <span>·</span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              readyJob.includeCaptions !== false
                ? "bg-zinc-800 text-zinc-400"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {readyJob.includeCaptions !== false ? "captions on" : "captions off"}
          </span>
          <span>·</span>
          <span>trending audio preserved from the reference reel</span>
        </div>
      </section>

      {plan && plan.shots.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-zinc-300">The edit plan</p>
            <p className="text-[11px] text-zinc-600">
              AI matched {plan.shots.filter((s) => s.clip).length} of {plan.shots.length} shots to
              your library
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {plan.shots.map((shot) => (
              <li
                key={shot.index}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
              >
                <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {shot.startAt.toFixed(1)}s
                </span>
                <span className="shrink-0 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                  {shot.beat}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                  {shot.captionText || (
                    <span className="text-zinc-600">no caption</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">
                  {shot.clip ? shot.clip.clipName : "⚠ no clip"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
