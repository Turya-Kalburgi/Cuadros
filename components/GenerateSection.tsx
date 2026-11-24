"use client";

import { useCallback, useEffect, useState } from "react";
import { GENERATE_STYLES, type GenerateJobMeta, type GenerateStyle } from "@/lib/types";

const STAGES = [
  { key: "planning", label: "Writing the shotlist" },
  { key: "rendering", label: "Painting scenes, captions & audio" },
] as const;

const STATUS_ORDER: Record<string, number> = { planning: 0, rendering: 1, ready: 2, error: -1 };
const DURATIONS = [15, 20, 30, 45, 60];

const STYLE_LABELS: Record<GenerateStyle, string> = {
  "cinematic-warm": "Cinematic Warm",
  documentary: "Clean Docu",
  "modern-minimal": "Minimalist",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  initialPrompt?: string;
  initialStyle?: string;
};

export default function GenerateSection({ initialPrompt = "", initialStyle }: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [style, setStyle] = useState<GenerateStyle>(
    GENERATE_STYLES.includes(initialStyle as GenerateStyle)
      ? (initialStyle as GenerateStyle)
      : "cinematic-warm",
  );
  const [duration, setDuration] = useState(30);
  const [includeNarration, setIncludeNarration] = useState(true);
  const [includeAmbient, setIncludeAmbient] = useState(true);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<GenerateJobMeta | null>(null);
  const [history, setHistory] = useState<GenerateJobMeta[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/generate");
      const data = (await res.json()) as { jobs?: GenerateJobMeta[] };
      setHistory(data.jobs ?? []);
    } catch {
      /* history is optional */
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/generate")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setHistory((data as { jobs?: GenerateJobMeta[] }).jobs ?? []);
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
        const res = await fetch(`/api/generate/${id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { job?: GenerateJobMeta };
        if (data.job) {
          setJob(data.job);
          if (data.job.status === "ready" || data.job.status === "error") void loadHistory();
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeJob, loadHistory]);

  const start = async () => {
    setError(null);
    if (prompt.trim().length < 4) {
      setError("Describe your video in a few words first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style,
          targetDuration: duration,
          includeNarration,
          includeAmbient,
          includeCaptions,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        job?: GenerateJobMeta;
        error?: string;
      } | null;
      if (!res.ok || !data?.job) throw new Error(data?.error ?? "Could not start generation.");
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start generation.");
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
            <h2 className="text-base font-semibold text-[#F5F5F0]">Generating your video…</h2>
            <p className="mt-0.5 max-w-md truncate text-xs text-[#929292]">{activeJob.prompt}</p>
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
        <p className="text-[11px] text-[#929292]">Keep this tab open — rendering takes about a minute.</p>
      </section>
    );
  }

  if (job?.status === "ready") {
    const shotlist = job.shotlist;
    return (
      <div className="space-y-6">
        <section className="rounded-2xl border border-[#292929] bg-[#191919] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#F5F5F0] flex items-center gap-2">
                Your generated video
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">
                  ready
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-[#929292]">
                {shotlist?.title || job.prompt} · {job.result?.durationSeconds.toFixed(1)}s ·{" "}
                {job.result?.shotsCount} scenes
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href={`/api/generate/${job.id}/video`}
                download="cuadros-generated.mp4"
                className="rounded-full bg-[#FFC800] px-5 py-2 text-xs font-semibold text-black hover:bg-[#D99A00] transition-colors"
              >
                ⬇ Download
              </a>
              <button
                type="button"
                onClick={reset}
                className="rounded-full border border-[#292929] px-5 py-2 text-xs text-[#F5F5F0] hover:border-[#FFC800]/50"
              >
                New video
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#292929] bg-black">
            <video
              key={job.id}
              src={`/api/generate/${job.id}/video`}
              controls
              playsInline
              className="mx-auto max-h-[70vh] w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#929292]">
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {shotlist?.aiUsed ? "AI-authored shotlist" : "Heuristic shotlist"}
            </span>
            <span className="rounded-full bg-[#292929] px-2 py-0.5">{STYLE_LABELS[job.style]}</span>
            <span className="rounded-full bg-[#292929] px-2 py-0.5">
              {job.result?.narrationUsed ? "narration on" : "narration off"}
            </span>
            {job.result?.captionsBurned && (
              <span className="rounded-full bg-[#292929] px-2 py-0.5">captions burned in</span>
            )}
          </div>
          {job.result?.narrationNote && (
            <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
              {job.result.narrationNote}
            </p>
          )}
        </section>

        {shotlist && shotlist.shots.length > 0 && (
          <section className="rounded-2xl border border-[#292929] bg-[#191919]/60 p-5">
            <p className="text-sm font-medium text-[#F5F5F0]">The shotlist</p>
            <ul className="mt-3 space-y-2">
              {shotlist.shots.map((shot) => (
                <li
                  key={shot.index}
                  className="flex flex-col gap-2 rounded-lg border border-[#292929] bg-[#080808]/60 px-3 py-3 sm:flex-row sm:items-center"
                >
                  <span className="shrink-0 rounded bg-[#292929] px-1.5 py-0.5 font-mono text-[10px] text-[#929292]">
                    {shot.startAt.toFixed(1)}s · {shot.durationSeconds.toFixed(1)}s
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-[#F5F5F0]">{shot.caption}</span>
                  <span className="min-w-0 flex-1 text-[11px] text-[#929292]">{shot.narration}</span>
                  <span className="min-w-0 flex-1 text-[11px] text-[#929292]/70">{shot.visual}</span>
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
            ✨ Generate a Video
            <span className="rounded-full bg-[#FFC800]/15 px-2.5 py-0.5 text-[10px] font-mono text-[#FFC800]">
              BETA
            </span>
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[#929292]">
            Describe an idea or paste a script. cuadros writes a shotlist, paints cinematic scenes,
            burns captions, and adds optional narration and an ambient bed — all rendered locally.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-[#F5F5F0]">Prompt or video script</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="A 30-second reel about a morning walk through Tokyo in warm light. One sentence per scene works best…"
            className="mt-1.5 w-full rounded-xl border border-[#292929] bg-[#080808] p-3 text-xs text-[#F5F5F0] placeholder:text-[#929292]/60 focus:border-[#FFC800]/60 focus:outline-none"
          />
        </label>

        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Visual style</span>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {GENERATE_STYLES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStyle(option)}
                className={`rounded-lg border px-3 py-2 text-center text-xs transition-all ${
                  style === option
                    ? "border-[#FFC800] bg-[#FFC800]/10 font-medium text-[#FFC800]"
                    : "border-[#292929] bg-[#080808] text-[#929292] hover:border-[#FFC800]/40"
                }`}
              >
                {STYLE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs font-medium text-[#F5F5F0]">Length</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`rounded-full px-4 py-1.5 text-xs transition-colors ${
                  duration === d
                    ? "bg-[#FFC800] font-semibold text-black"
                    : "border border-[#292929] text-[#929292] hover:border-[#FFC800]/50"
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["Narration", includeNarration, setIncludeNarration],
              ["Ambient audio", includeAmbient, setIncludeAmbient],
              ["Captions", includeCaptions, setIncludeCaptions],
            ] as const
          ).map(([label, value, setter]) => (
            <button
              key={label}
              type="button"
              role="switch"
              aria-checked={value}
              onClick={() => setter(!value)}
              className="flex items-center justify-between gap-2 rounded-xl border border-[#292929] bg-[#080808] px-3 py-2 text-xs text-[#F5F5F0]"
            >
              <span>{label}</span>
              <span
                className={`h-4 w-8 shrink-0 rounded-full transition-colors ${
                  value ? "bg-[#FFC800]" : "bg-[#292929]"
                }`}
              />
            </button>
          ))}
        </div>

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
          disabled={submitting || prompt.trim().length < 4}
          className="w-full rounded-full bg-[#FFC800] px-8 py-3 text-sm font-semibold text-black shadow-md transition-all hover:bg-[#D99A00] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {submitting ? "Starting…" : "🎬 Generate Video"}
        </button>
      </section>

      {historyLoaded && history.length > 0 && (
        <section className="rounded-2xl border border-[#292929] bg-[#191919]/60 p-5">
          <p className="text-sm font-medium text-[#F5F5F0]">Recent generations</p>
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
                      {h.shotlist?.title || h.prompt}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#929292]">
                      {h.targetDuration}s · {STYLE_LABELS[h.style]} · {fmtDate(h.createdAt)}
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
