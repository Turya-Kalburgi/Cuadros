import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { generateJson } from "./ai";
import { resolveFfmpeg, resolveYtDlp } from "./binaries";
import { countEventsIn } from "./activity";
import { analyzeFaces, hammingDistance, type FaceShotInfo } from "./faces";
import type { SongArc } from "./song_catalog";
import { cleanShotDuration, INSTA_RULES } from "./insta_dataset";
import type {
  AutoClipMode,
  AutoClipPlan,
  AutoClipRange,
  AutoClipType,
  AutoClipSourceAnalysis,
  SceneEvent,
  Silence,
  SubtitleCue,
} from "./types";

const execFileAsync = promisify(execFile);

const STOP_WORDS = new Set(
  "this that with from have just about what when where which who why how into your ours their they them then than there here were was are has had does did will would could should because really very around down back over under again still even only more most some such other over been being also much many make made like gets got going gonna yeah okay".split(
    " ",
  ),
);

function shortText(text: string, max = 64): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function topKeywords(text: string, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (word.length < 4 || STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

export function parseVtt(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = raw.replace(/^\ufeff/, "").split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const line = block.split(/\r?\n/).findIndex((l) => l.includes("-->"));
    if (line < 0) continue;
    const lines = block.split(/\r?\n/);
    const match = /(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})/.exec(
      lines[line],
    );
    if (!match) continue;
    const parse = (value: string) => {
      const [h, m, rest] = value.split(":");
      const [s, ms] = rest.replace(",", ".").split(".");
      return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms ?? 0) / 1000;
    };
    const start = parse(match[1]);
    const end = parse(match[2]);
    const text = lines
      .slice(line + 1)
      .map((l) => l.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim())
      .filter(Boolean)
      .join(" ");
    if (!text || end <= start) continue;
    const previous = cues[cues.length - 1];
    if (previous && Math.abs(previous.start - start) < 0.05 && previous.text === text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export async function fetchSubtitles(url: string, dir: string): Promise<SubtitleCue[]> {
  const ytDlp = await resolveYtDlp();
  if (!ytDlp) return [];
  try {
    await execFileAsync(
      ytDlp,
      [
        "--skip-download",
        "--no-playlist",
        "--write-auto-subs",
        "--write-subs",
        "--sub-langs",
        "en.*,en",
        "--sub-format",
        "vtt",
        "-o",
        path.join(dir, "subs.%(ext)s"),
        url,
      ],
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    return [];
  }
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.startsWith("subs.") && f.endsWith(".vtt"));
  } catch {
    return [];
  }
  if (files.length === 0) return [];
  const preferred = files.find((f) => /\.en(?:\.\w+)?\.vtt$/i.test(f)) ?? files[0];
  try {
    const raw = await fs.readFile(path.join(dir, preferred), "utf8");
    const cues = parseVtt(raw);
    await Promise.all(files.map((f) => fs.unlink(path.join(dir, f)).catch(() => undefined)));
    return cues;
  } catch {
    return [];
  }
}

async function detectScenes(videoPath: string): Promise<SceneEvent[]> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return [];
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        "-i",
        videoPath,
        "-vf",
        "select='gt(scene,0.012)',metadata=print:key=lavfi.scene_score",
        "-an",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 128 * 1024 * 1024 },
    );
    const events: SceneEvent[] = [];
    let at: number | null = null;
    for (const line of stderr.split("\n")) {
      const timeMatch = /pts_time:([\d.]+)/.exec(line);
      if (timeMatch) {
        at = parseFloat(timeMatch[1]);
        continue;
      }
      const scoreMatch = /lavfi\.scene_score=([\d.]+)/.exec(line);
      if (scoreMatch && at !== null) {
        events.push({ at: Math.round(at * 100) / 100, score: parseFloat(scoreMatch[1]) });
        at = null;
      }
    }
    return events.sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

async function detectSilences(videoPath: string): Promise<Silence[]> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return [];
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      ["-i", videoPath, "-af", "silencedetect=noise=-34dB:d=0.45", "-f", "null", "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const silences: Silence[] = [];
    let start: number | null = null;
    for (const line of stderr.split("\n")) {
      const s = /silence_start:\s*([\d.]+)/.exec(line);
      if (s) {
        start = parseFloat(s[1]);
        continue;
      }
      const e = /silence_end:\s*([\d.]+)/.exec(line);
      if (e && start !== null) {
        silences.push({ start, end: parseFloat(e[1]) });
        start = null;
      }
    }
    return silences;
  } catch {
    return [];
  }
}

export async function analyzeSource(
  videoPath: string,
  durationSeconds: number,
  cues: SubtitleCue[],
  hasAudio: boolean,
): Promise<AutoClipSourceAnalysis> {
  const activity = await detectScenes(videoPath);
  const silences = hasAudio ? await detectSilences(videoPath) : [];
  const hardCuts = activity
    .filter((e) => e.score >= 0.22 && e.at > 0.5 && e.at < durationSeconds - 0.5)
    .map((e) => e.at);
  return {
    durationSeconds,
    activity,
    silences,
    hardCuts,
    cues,
    hasSubtitles: cues.length >= 3,
    hasAudio,
  };
}

type Window = {
  start: number;
  end: number;
  cues: SubtitleCue[];
  words: number;
  activity: number;
  hardCuts: number;
  hook: number;
  cleanEnd: boolean;
  silenceRatio: number;
  keywords: string[];
  transcript: string;
  score: number;
};

function silenceCoverage(silences: Silence[], start: number, end: number): number {
  const span = Math.max(0.1, end - start);
  let covered = 0;
  for (const s of silences) {
    covered += Math.max(0, Math.min(end, s.end) - Math.max(start, s.start));
  }
  return Math.min(1, covered / span);
}

function makeWindow(
  analysis: AutoClipSourceAnalysis,
  focus: string,
  rawStart: number,
  rawEnd: number,
): Window {
  const { durationSeconds, cues, activity, hardCuts, silences } = analysis;
  const focusWords = focus
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const start = Math.max(0, rawStart);
  const end = Math.min(durationSeconds, rawEnd);
  const windowCues = cues.filter((c) => c.end > start && c.start < end);
  const transcript = windowCues.map((c) => c.text).join(" ");
  const words = windowCues.reduce((n, c) => {
    const overlap = Math.max(0, Math.min(end, c.end) - Math.max(start, c.start));
    return n + Math.round((overlap / Math.max(0.1, c.end - c.start)) * wordCount(c.text));
  }, 0);
  const windowActivity = activity.filter((e) => e.at >= start && e.at < end);
  const cuts = hardCuts.filter((c) => c >= start && c < end).length;
  const hook = countEventsIn(
    activity.map((e) => e.at),
    start,
    Math.min(3, end - start),
  );
  const cleanEnd =
    silences.some((s) => s.start >= end - 3 && s.start <= end + 0.5) ||
    hardCuts.some((c) => c >= end - 2.5 && c <= end + 0.5);
  const silenceRatio = silenceCoverage(silences, start, end);
  const keywords = topKeywords(transcript);
  const lower = transcript.toLowerCase();
  const focusBonus = focusWords.filter((w) => lower.includes(w)).length * 4;
  const story = Math.min(words, 140) * 0.34 + (cues.length > 0 ? 8 : 0);
  const visual = windowActivity.reduce((n, e) => n + Math.min(e.score, 0.5), 0) * 4 + cuts * 1.5;
  const audio = hook * 1.8 + (cleanEnd ? 6 : 0) - silenceRatio * 9;
  return {
    start,
    end,
    cues: windowCues,
    words,
    activity: windowActivity.length,
    hardCuts: cuts,
    hook,
    cleanEnd,
    silenceRatio,
    keywords,
    transcript,
    score: visual + story + audio + focusBonus,
  };
}

export function buildBestWindows(
  analysis: AutoClipSourceAnalysis,
  target: number,
  focus: string,
  requestedCount: number,
): Window[] {
  const duration = analysis.durationSeconds;
  const step = Math.max(2, target / 2);
  const candidates: Window[] = [];
  for (let start = 0; start + target * 0.9 <= duration; start += step) {
    candidates.push(makeWindow(analysis, focus, start, start + target));
  }
  if (candidates.length === 0) {
    candidates.push(makeWindow(analysis, focus, 0, Math.min(duration, target)));
  }

  const count = Math.min(40, Math.max(1, requestedCount));
  const chosen: Window[] = [];
  const separated = (window: Window, minGap: number) =>
    chosen.some((c) => Math.abs(c.start - window.start) < minGap);

  for (const window of [...candidates].sort((a, b) => b.score - a.score)) {
    if (separated(window, target * 0.85)) continue;
    chosen.push(window);
    if (chosen.length >= count) break;
  }
  for (const window of candidates) {
    if (chosen.length >= count) break;
    if (chosen.includes(window) || separated(window, target * 0.5)) continue;
    chosen.push(window);
  }

  return chosen.sort((a, b) => a.start - b.start);
}

function buildRanges(
  window: Window,
  analysis: AutoClipSourceAnalysis,
  target: number,
  type: AutoClipType,
): AutoClipRange[] {
  const { hardCuts, silences, cues, durationSeconds } = analysis;
  const talking = type === "talking";
  const bounds = new Set<number>([window.start, window.end]);
  const within = (t: number) => t > window.start + 0.4 && t < window.end - 0.4;
  for (const cut of hardCuts) if (within(cut)) bounds.add(cut);
  for (const s of silences) {
    if (within(s.start)) bounds.add(s.start);
    if (within(s.end)) bounds.add(s.end);
  }
  for (const cue of cues) {
    if (within(cue.start)) bounds.add(cue.start);
    if (within(cue.end)) bounds.add(cue.end);
  }
  const sorted = [...bounds].sort((a, b) => a - b);

  type Segment = { start: number; end: number; score: number };
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    const dur = end - start;
    if (dur < 0.6) continue;
    const pieces = Math.ceil(dur / 9);
    for (let p = 0; p < pieces; p++) {
      const s = start + (dur * p) / pieces;
      const e = start + (dur * (p + 1)) / pieces;
      const length = e - s;
      if (length < 0.6) continue;
      let words = 0;
      for (const cue of cues) {
        const overlap = Math.max(0, Math.min(e, cue.end) - Math.max(s, cue.start));
        if (overlap > 0) {
          words += Math.round((overlap / Math.max(0.1, cue.end - cue.start)) * wordCount(cue.text));
        }
      }
      const activity = countEventsIn(
        analysis.activity.map((ev) => ev.at),
        s,
        length,
      );
      const cuts = hardCuts.filter((c) => c >= s && c < e).length;
      const silenceRatio = silenceCoverage(silences, s, e);
      const lengthBonus = length >= 1.4 && length <= 5.5 ? 1.2 : 0;
      const score = talking
        ? activity * 0.8 +
          Math.min(words, 22) * 0.9 +
          cuts * 1 +
          lengthBonus -
          silenceRatio * 6
        : activity * 2.4 +
          Math.min(words, 22) * 0.15 +
          cuts * 2.5 +
          lengthBonus -
          silenceRatio * 0.5;
      segments.push({ start: s, end: e, score });
    }
  }

  const chosen: Segment[] = [];
  let total = 0;
  for (const seg of [...segments].sort((a, b) => b.score - a.score)) {
    if (total + (seg.end - seg.start) <= target + 0.05) {
      chosen.push(seg);
      total += seg.end - seg.start;
    }
    if (total >= target * 0.985) break;
  }
  if (total < target * 0.9) {
    const used = new Set(chosen);
    for (const seg of [...segments].sort((a, b) => b.score - a.score)) {
      if (used.has(seg) || total >= target * 0.99) continue;
      chosen.push(seg);
      total += seg.end - seg.start;
    }
  }
  chosen.sort((a, b) => a.start - b.start);

  if (chosen.length === 0) {
    const start = Math.max(0, window.start);
    const end = Math.min(durationSeconds, Math.min(window.end, start + target));
    return [{ start, end, score: 1 }];
  }

  if (total < target - 0.2) {
    const last = chosen[chosen.length - 1];
    const extra = Math.min(target - total, window.end - last.end, durationSeconds - last.end);
    if (extra > 0.2) last.end += extra;
  }

  return chosen
    .map((seg) => {
      const start = Math.max(window.start, seg.start);
      const end = Math.min(window.end, Math.max(start + 0.4, seg.end));
      return {
        start: Math.round(start * 10) / 10,
        end: Math.round(end * 10) / 10,
        score: Math.round(seg.score * 100) / 100,
      };
    })
    .filter((r) => r.end - r.start >= 0.4);
}

function titleFor(window: Window, sequence: number, type: AutoClipType): string {
  if (type === "visual") return `Visual reel ${sequence} · ${fmtClock(window.start)}`;
  const spoken = window.cues.find((c) => wordCount(c.text) >= 3);
  if (spoken) return shortText(spoken.text, 64);
  if (window.keywords.length > 0) return `The ${window.keywords[0]} story`;
  return `Talking reel ${sequence} · ${fmtClock(window.start)}`;
}

function reasonFor(window: Window, type: AutoClipType): string {
  if (type === "visual") {
    return `${window.hardCuts} distinct shots with strong visual movement from ${fmtClock(window.start)} to ${fmtClock(window.end)} — silent, ready for your own song.`;
  }
  const hook = window.hook > 0 ? "a strong opening hook" : "steady visual pacing";
  const ending = window.cleanEnd ? "a clean ending" : "an energetic finish";
  return `Chosen for ${window.words}-word dialogue, ${window.hardCuts} visual cuts, ${hook}, and ${ending}.`;
}

type MontageShot = Window & {
  faceIds: number[];
  hash: string;
  priority: number;
  kind: string;
  faceless: boolean;
  energy: number;
  color: number[];
  quality: number;
  otherFacesFlag: boolean;
  extraPeopleFlag: boolean;
};

function colorDistance(a: number[], b: number[]): number {
  if (a.length !== 3 || b.length !== 3) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function buildMontageShots(
  analysis: AutoClipSourceAnalysis,
  shotLength: number,
  focus: string,
  count: number,
  maxLength = 5,
): Window[] {
  const duration = analysis.durationSeconds;
  const length = Math.min(maxLength, Math.max(1.5, shotLength));
  const step = Math.max(0.6, length * 0.5);
  const buckets = Math.max(1, Math.min(count, Math.floor(duration / Math.max(1, length * 0.9))));
  const bucketSize = duration / buckets;
  const chosen: Window[] = [];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = bucket * bucketSize;
    const to = Math.min(duration, from + bucketSize);
    let best: Window | null = null;
    for (let start = from; start + Math.min(length, (to - from) * 0.5) <= to; start += step) {
      if (start + length > duration) break;
      const window = makeWindow(analysis, focus, start, start + length);
      if (!best || window.score > best.score) best = window;
    }
    if (best && !chosen.some((item) => Math.abs(item.start - best!.start) < length * 0.8)) {
      chosen.push(best);
    }
  }
  if (chosen.length < count) {
    const fallback: Window[] = [];
    for (let start = 0; start + length * 0.85 <= duration; start += step) {
      fallback.push(makeWindow(analysis, focus, start, Math.min(duration, start + length)));
    }
    fallback.sort((a, b) => b.score - a.score);
    for (const window of fallback) {
      if (chosen.length >= count) break;
      if (chosen.some((item) => Math.abs(item.start - window.start) < length * 0.8)) continue;
      chosen.push(window);
    }
  }
  return chosen;
}

async function planClean(input: PlanAutoClipsInput, targetDuration: number): Promise<AutoClipPlan[]> {
  const { analysis, clipCount, focus, mode, sourceFile, faceMode = "main" } = input;
  const duration = cleanShotDuration(targetDuration);
  const base = buildMontageShots(analysis, duration, focus, 40, 40);
  if (base.length === 0) return [];
  const faceData = await analyzeFaces(
    sourceFile,
    base.map((shot) => ({ start: shot.start, end: shot.end })),
  );
  const byIndex = new Map<number, FaceShotInfo>();
  faceData?.shots.forEach((info, index) => byIndex.set(index, info));

  const pool = base
    .map((shot, index) => {
      const info = byIndex.get(index);
      const ids = info?.ids ?? [];
      if (info?.phone) return null;
      if (faceMode === "main" && (info?.otherFaces || (info?.people ?? 0) > 1)) return null;
      const color = info?.color ?? [];
      const saturation = color.length === 3 ? Math.max(...color) - Math.min(...color) : 62;
      const bright = info?.bright ?? 125;
      const sharp = info?.sharp ?? 200;
      const kind = info?.kind ?? "wide";
      const faceSize = info?.faceSize ?? 0;
      const edge = info?.edge ?? 0;
      const quality =
        Math.min(8, sharp / 120) -
        Math.max(0, 105 - bright) * 0.8 -
        Math.max(0, bright - 155) * 0.8 -
        Math.abs(saturation - 63) / 12 +
        (INSTA_RULES.preferKinds.includes(kind) ? 6 : 0) +
        (INSTA_RULES.avoidCloseFace && (faceSize > 0.22 || kind === "close") ? -10 : 0) -
        Math.max(0, edge - 0.09) * 30 +
        (info?.faceless ? 3 : 0);
      return {
        ...shot,
        quality,
        rank: quality + Math.random() * 2,
        faceIds: ids,
        hash: info?.hash ?? "",
        color,
        qualityRaw: quality,
        mainFace: info?.mainFace ?? false,
        phone: info?.phone ?? false,
        extraPeople: (info?.people ?? 0) > 1,
        otherFaces: info?.otherFaces ?? false,
        faceless: info?.faceless ?? true,
        kind: info?.kind ?? "wide",
        energy: Math.min(1, (info?.motion ?? 0) * 3 + Math.min(1, shot.activity / 8) * 0.5),
      };
    })
    .filter((shot): shot is NonNullable<typeof shot> => shot !== null)
    .sort((a, b) => b.rank - a.rank);

  const chosen: typeof pool = [];
  const buckets = clipCount;
  const bucketSize = analysis.durationSeconds / buckets;
  const fits = (shot: (typeof pool)[number]) =>
    !chosen.some((item) => item.hash && shot.hash && hammingDistance(item.hash, shot.hash) < 8) &&
    !chosen.some((item) => colorDistance(item.color, shot.color) < 35) &&
    !chosen.some((item) => item.kind === shot.kind);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = bucket * bucketSize;
    const to = (bucket + 1) * bucketSize;
    const inBucket = pool.filter((shot) => shot.start >= from && shot.start < to);
    const pick = inBucket.find(fits) ?? inBucket[0];
    if (pick) chosen.push(pick);
  }
  if (chosen.length < clipCount) {
    for (const shot of pool) {
      if (chosen.includes(shot)) continue;
      chosen.push(shot);
      if (chosen.length >= clipCount) break;
    }
  }
  if (chosen.length === 0) return [];

  const labels = new Map<number, { title: string; hook: string | null }>();
  const { data } = await generateJson(`You are naming calm, good-looking lifestyle reels. Each reel is ONE continuous ${Math.round(duration)}s shot from a longer vlog, with a song and minimal text.
${focus ? `Creator focus: ${focus}\n` : ""}
Reels:
${chosen.map((shot, i) => `${i}: ${shortText(shot.transcript, 140) || "(visual only)"}`).join("\n")}
Respond with ONLY JSON: { "labels": [ { "index": 0, "title": "max 6 words", "hook": "max 8 words, lowercase" } ] }`);
  if (data && typeof data === "object" && Array.isArray((data as { labels?: unknown }).labels)) {
    for (const raw of (data as { labels: unknown[] }).labels) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as { index?: unknown; title?: unknown; hook?: unknown };
      if (
        typeof item.index === "number" &&
        item.index >= 0 &&
        item.index < chosen.length &&
        typeof item.title === "string" &&
        item.title.trim()
      ) {
        labels.set(item.index, {
          title: shortText(item.title, 64),
          hook: typeof item.hook === "string" && item.hook.trim() ? shortText(item.hook, 60) : null,
        });
      }
    }
  }

  const titlePool = ["Quiet Morning", "Soft Light", "A Slow Moment", "Golden Hour", "Little Rituals", "Room Reset", "Open Curtains"];
  return chosen.map((shot, index) => {
    const type: AutoClipType = mode === "both" ? (index % 2 === 0 ? "talking" : "visual") : mode;
    const end = Math.min(analysis.durationSeconds, shot.end);
    return {
      index,
      sequence: index + 1,
      type,
      title: labels.get(index)?.title ?? titlePool[index % titlePool.length],
      hook: labels.get(index)?.hook ?? undefined,
      reason: `One calm ${Math.round(duration)}s continuous shot with natural light, set to your song — no random cuts.`,
      startAt: shot.start,
      endAt: end,
      durationSeconds: end - shot.start,
      ranges: [
        {
          start: Math.round(shot.start * 10) / 10,
          end: Math.round(end * 10) / 10,
          score: Math.round(shot.score * 100) / 100,
        },
      ],
      keywords: shot.keywords,
      score: Math.round(shot.quality * 100) / 100,
      aiUsed: labels.has(index),
      mute: type === "visual",
    };
  });
}

async function planMontage(
  input: PlanAutoClipsInput,
  shotLength: number,
): Promise<AutoClipPlan[]> {
  const {
    analysis,
    targetDuration,
    clipCount,
    focus,
    mode,
    sourceFile,
    faceMode = "main",
  } = input;
  const length = Math.min(5, Math.max(1.5, shotLength));
  const shotsPerReel = Math.max(2, Math.round(targetDuration / length));
  const poolLimit = Math.min(140, Math.max(shotsPerReel * clipCount * 2, 60));
  const baseShots = buildMontageShots(analysis, length, focus, poolLimit);
  if (baseShots.length === 0) return [];

  const faceData = await analyzeFaces(
    sourceFile,
    baseShots.map((shot) => ({ start: shot.start, end: shot.end })),
  );
  const dominant = faceData?.dominant ?? null;
  const byIndex = new Map<number, FaceShotInfo>();
  faceData?.shots.forEach((info, i) => byIndex.set(i, info));

  const pool: MontageShot[] = baseShots
    .map((shot, i): MontageShot | null => {
      const info = byIndex.get(i);
      const ids = info?.ids ?? [];
      const otherFaces =
        info?.otherFaces ?? (dominant !== null && ids.some((id) => id !== dominant));
      const phone = info?.phone === true;
      const extraPeople = (info?.people ?? 0) > 1;
      if (phone) return null;
      if (faceMode === "faceless" && ids.length > 0) return null;

      const sharp = info?.sharp ?? 0;
      const bright = info?.bright ?? 110;
      const contrast = info?.contrast ?? 50;
      const faceBright = info?.faceBright ?? bright;
      const faceMin = info?.faceMin ?? 0;
      const quality =
        Math.min(8, sharp / 120) -
        Math.max(0, 55 - bright) / 12 -
        Math.max(0, bright - 195) / 12 +
        Math.min(4, contrast / 25) +
        Math.min(4, faceBright / 55) +
        Math.min(2, faceMin / 35) -
        Math.max(0, 100 - faceBright) / 18;
      if (bright < 45 || sharp < 25) return null;
      const faceBonus =
        faceMode === "main"
          ? info?.mainFace
            ? 10
            : -4
          : faceMode === "faceless"
            ? ids.length === 0
              ? 8
              : -10
            : 0;
      return {
        ...shot,
        faceIds: ids,
        hash: info?.hash ?? "",
        priority: shot.score + quality + faceBonus,
        kind: info?.kind ?? "wide",
        faceless: info?.faceless ?? true,
        energy: Math.min(1, (info?.motion ?? 0) * 3 + Math.min(1, shot.activity / 8) * 0.5),
        color: info?.color ?? [],
        quality,
        otherFacesFlag: otherFaces,
        extraPeopleFlag: extraPeople,
      };
    })
    .filter((shot): shot is MontageShot => shot !== null);
  if (pool.length === 0) {
    for (const shot of baseShots) {
      pool.push({
        ...shot,
        faceIds: [],
        hash: "",
        priority: shot.score,
        kind: "wide",
        faceless: true,
        energy: Math.min(1, shot.activity / 8),
        color: [],
        quality: 0,
        otherFacesFlag: false,
        extraPeopleFlag: false,
      });
    }
  }
  pool.sort((a, b) => b.priority - a.priority);
  const qualityValues = pool.map((shot) => shot.quality).sort((a, b) => a - b);
  const qualityFloor = qualityValues[Math.floor(qualityValues.length * 0.35)] ?? 0;

  const PREVIEW = 4;
  const used = new Set<MontageShot>();
  const usedHashes: string[] = [];
  const usedFaces = new Map<number, number>();
  const picksByReel: Array<{ main: Window[]; preview: Window[] }> = [];
  for (let r = 0; r < clipCount; r++) {
    const picks: MontageShot[] = [];
    const usedKinds = new Set<string>();
    const usedColors: number[][] = [];
    const collect = (relaxed: boolean) => {
      let cursor = r % pool.length;
      let attempts = 0;
      while (picks.length < shotsPerReel + PREVIEW && attempts < pool.length) {
        const shot = pool[cursor];
        cursor = (cursor + clipCount) % pool.length;
        attempts++;
        if (used.has(shot)) continue;
        if (faceMode === "main" && shot.otherFacesFlag) continue;
        if (!relaxed && shot.quality < qualityFloor) continue;
        if (!relaxed && faceMode === "main" && shot.extraPeopleFlag) continue;
        if (faceMode === "faceless" && !shot.faceless && !relaxed) continue;
        if (!relaxed && usedKinds.has(shot.kind)) continue;
        if (!relaxed && usedHashes.some((hash) => hammingDistance(hash, shot.hash) < 6)) {
          continue;
        }
        if (!relaxed && usedColors.some((color) => colorDistance(color, shot.color) < 18)) {
          continue;
        }
        if (
          !relaxed &&
          faceMode !== "main" &&
          shot.faceIds.some((id) => (usedFaces.get(id) ?? 0) >= 2)
        ) {
          continue;
        }
        used.add(shot);
        usedKinds.add(shot.kind);
        if (shot.hash) usedHashes.push(shot.hash);
        if (shot.color.length === 3) usedColors.push(shot.color);
        picks.push(shot);
        for (const id of shot.faceIds) usedFaces.set(id, (usedFaces.get(id) ?? 0) + 1);
      }
    };
    collect(false);
    if (picks.length < shotsPerReel + PREVIEW) collect(true);
    if (picks.length === 0) continue;
    const preview = picks.slice(0, Math.min(PREVIEW, Math.max(0, picks.length - 3)));
    const rest = picks.slice(preview.length);
    const chronological = [...rest].sort((a, b) => a.start - b.start);
    const hook = [...chronological].sort((a, b) => b.priority - a.priority)[0];
    const ending = [...chronological].sort((a, b) => a.activity - b.activity)[0];
    const body = chronological.filter((shot) => shot !== hook && shot !== ending);
    const main: Window[] = [
      ...(hook ? [hook] : []),
      ...body,
      ...(ending && ending !== hook ? [ending] : []),
    ];
    picksByReel.push({ main, preview });
  }
  if (picksByReel.length === 0) return [];

  const labels = new Map<number, { title: string; hook: string | null }>();
  const { data } = await generateJson(`You are naming short music-driven highlight reels. Each reel opens with the strongest shot, builds through a rapid montage of ${length}s shots sampled across one long video, and lands on a calm closing shot.
${focus ? `Creator focus: ${focus}\n` : ""}
Reels (index, dialogue excerpt):
${picksByReel
  .map((reel, i) => `${i}: ${shortText(reel.main.map((p) => p.transcript).join(" "), 160) || "(visual only)"}`)
  .join("\n")}

Write one catchy title (max 6 words) and one short on-screen hook line (max 8 words, lowercase, like "pov: a quiet morning alone") per reel. Respond with ONLY JSON:
{ "labels": [ { "index": 0, "title": "...", "hook": "..." } ] }`);
  if (data && typeof data === "object" && Array.isArray((data as { labels?: unknown }).labels)) {
    for (const raw of (data as { labels: unknown[] }).labels) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as { index?: unknown; title?: unknown; hook?: unknown };
      if (
        typeof item.index === "number" &&
        item.index >= 0 &&
        item.index < picksByReel.length &&
        typeof item.title === "string" &&
        item.title.trim()
      ) {
        labels.set(item.index, {
          title: shortText(item.title, 64),
          hook: typeof item.hook === "string" && item.hook.trim() ? shortText(item.hook, 60) : null,
        });
      }
    }
  }

  return picksByReel.map((reel, r) => {
    const picks = reel.main;
    const type: AutoClipType = mode === "both" ? (r % 2 === 0 ? "talking" : "visual") : mode;
    const previewRanges: AutoClipRange[] = reel.preview.map((shot) => ({
      start: Math.round(shot.start * 10) / 10,
      end: Math.round(Math.min(shot.end, shot.start + 0.35) * 10) / 10,
      score: Math.round(shot.score * 100) / 100,
    }));
    const mainRanges: AutoClipRange[] = picks.map((shot, idx) => {
      const isEnding = idx === picks.length - 1;
      const end = isEnding
        ? Math.min(analysis.durationSeconds, shot.end + Math.min(0.9, length * 0.35))
        : shot.end;
      return {
        start: Math.round(shot.start * 10) / 10,
        end: Math.round(end * 10) / 10,
        score: Math.round(shot.score * 100) / 100,
      };
    });
    const ranges = [...previewRanges, ...mainRanges];
    const keywords = [...new Set([...reel.preview, ...picks].flatMap((p) => p.keywords))].slice(0, 4);
    const titlePool = [
      "Quiet Morning", "Slow Rituals", "Golden Hour", "Soft Start", "A Day Alone",
      "Little Moments", "Morning Light", "Slow Living Diary", "Coffee & Calm",
      "Window Seat", "Reset Day", "Evening Glow", "Small Joys", "Open Curtains",
    ];
    const titleSeed = [...focus].reduce((sum, char) => sum + char.charCodeAt(0), 0) + r * 5;
    const fallbackTitle = titlePool[titleSeed % titlePool.length];
    return {
      index: r,
      sequence: r + 1,
      type,
      title: labels.get(r)?.title ?? fallbackTitle,
      hook: labels.get(r)?.hook ?? undefined,
      reason: `A 2s flash of best moments, then ${picks.length} chronological cuts through the day — wide, close and detail, no repeats.`,
      startAt: Math.min(...picks.map((p) => p.start)),
      endAt: Math.max(...picks.map((p) => p.end)),
      durationSeconds: ranges.reduce((n, range) => n + range.end - range.start, 0),
      ranges,
      keywords,
      score: Math.round(
        (picks.reduce((n, p) => n + p.score, 0) / Math.max(1, picks.length)) * 100,
      ) / 100,
      aiUsed: labels.has(r),
      mute: type === "visual",
    };
  });
}

export type PlanAutoClipsInput = {
  analysis: AutoClipSourceAnalysis;
  targetDuration: number;
  clipCount: number;
  focus: string;
  mode: AutoClipMode;
  shotLength?: number;
  sourceFile: string;
  faceMode?: "main" | "faceless" | "any";
  songArc?: SongArc;
  editStyle?: "clean" | "montage";
};

export async function planAutoClips(input: PlanAutoClipsInput): Promise<AutoClipPlan[]> {
  const { analysis, targetDuration, clipCount, focus, mode, shotLength, editStyle = "clean" } = input;
  if (editStyle === "clean") {
    return planClean(input, targetDuration);
  }
  if (typeof shotLength === "number" && shotLength >= 1.5 && shotLength <= 5) {
    return planMontage(input, shotLength);
  }
  const windows = buildBestWindows(analysis, targetDuration, focus, clipCount);
  if (windows.length === 0) return [];

  const labels = new Map<number, { title?: unknown; reason?: unknown }>();
  let aiUsed = false;
  const sample = windows.slice(0, 20);
  const { data } = await generateJson(`You are writing titles for the best short reels selected from one long video.
${focus ? `Creator focus: ${focus}\n` : ""}
Reels (index, time range, dialogue excerpt):
${sample
  .map(
    (w, i) =>
      `${i}: ${fmtClock(w.start)}-${fmtClock(w.end)} | ${shortText(w.transcript, 180) || "(no subtitle transcript)"}`,
  )
  .join("\n")}

Write a short, specific title and one-sentence reason for each reel. Respond with ONLY JSON:
{ "labels": [ { "index": 0, "title": "max 8 words", "reason": "one short sentence" } ] }`);

  if (data && typeof data === "object" && Array.isArray((data as { labels?: unknown }).labels)) {
    for (const raw of (data as { labels: unknown[] }).labels) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as { index?: unknown; title?: unknown; reason?: unknown };
      if (typeof item.index === "number" && item.index >= 0 && item.index < windows.length) {
        labels.set(item.index, item);
      }
    }
    aiUsed = labels.size > 0;
  }

  const plans: AutoClipPlan[] = [];
  windows.forEach((window, i) => {
    const sequence = i + 1;
    const type: AutoClipType =
      mode === "both" ? (i % 2 === 0 ? "talking" : "visual") : mode;
    const ranges = buildRanges(window, analysis, targetDuration, type);
    const label = labels.get(i);
    plans.push({
      index: plans.length,
      sequence,
      type,
      title: shortText(
        String(label?.title ?? "").trim() || titleFor(window, sequence, type),
        64,
      ),
      reason: shortText(
        String(label?.reason ?? "").trim() || reasonFor(window, type),
        180,
      ),
      startAt: window.start,
      endAt: window.end,
      durationSeconds: ranges.reduce((n, r) => n + r.end - r.start, 0),
      ranges,
      keywords: window.keywords,
      score: Math.round(window.score * 100) / 100,
      aiUsed: type === "talking" && aiUsed,
      mute: type === "visual",
    });
  });
  return plans;
}
