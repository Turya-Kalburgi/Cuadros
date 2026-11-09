import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { resolveFfmpeg } from "./binaries";
import { probeMedia } from "./media";
import { analyzeReel, planShots } from "./ai";
import { beatsForCount, extractMeanColor, pickBestWindow } from "./recreate-helpers";
import { loadClipActivity } from "./activity";
import { downloadVideoToDir } from "./ingest";
import {
  buildSrt,
  burnPngCaptions,
  renderCaptionPngs,
  supportsAssFilter,
  supportsPillow,
} from "./captions";
import type {
  EditPlan,
  LibraryClip,
  ReelAnalysis,
  RecreateBeat,
  ShotPlan,
} from "./types";

const execFileAsync = promisify(execFile);

function runFfmpeg(args: string[], opts?: { cwd?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    void resolveFfmpeg().then((ffmpeg) => {
      if (!ffmpeg) {
        reject(new Error("ffmpeg not found."));
        return;
      }
      const child = execFile(
        ffmpeg,
        args,
        { maxBuffer: 32 * 1024 * 1024, cwd: opts?.cwd, env: process.env },
        (err) => {
          if (err) reject(new Error(`ffmpeg failed: ${err.message}`));
          else resolve();
        },
      );
      void child;
    }, reject);
  });
}

// ---------------------------------------------------------------------------
// Stage 1 — ingest reference
// ---------------------------------------------------------------------------

export async function downloadReference(
  url: string,
  jobDir: string,
  onProgress?: (pct: number) => void,
): Promise<{ filePath: string; title: string | null }> {
  return downloadVideoToDir(url, jobDir, onProgress, "reference");
}

// ---------------------------------------------------------------------------
// Stage 2 — deterministic feature extraction
// ---------------------------------------------------------------------------

export async function detectSceneCuts(videoPath: string, maxDuration: number): Promise<number[]> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg not found");

  const cuts: number[] = [];
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        "-i",
        videoPath,
        "-t",
        maxDuration.toFixed(2),
        "-vf",
        "select='gt(scene,0.22)',showinfo",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const regex = /pts_time:([0-9.]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(stderr)) !== null) {
      const t = parseFloat(match[1]);
      if (Number.isFinite(t) && t > 0.6 && t < maxDuration - 0.5) {
        if (cuts.length === 0 || t - cuts[cuts.length - 1] >= 0.7) {
          cuts.push(Math.round(t * 100) / 100);
        }
      }
    }
  } catch {
    /* fall through to rhythmic synthesis */
  }

  if (cuts.length < 3) {
    const pattern = [2.2, 1.6, 1.4, 2.0, 1.8, 1.2, 2.4, 1.9, 1.5, 2.1, 1.7, 2.3, 1.8, 2.0, 2.5, 1.8];
    const synth: number[] = [];
    let cur = 0;
    for (const d of pattern) {
      if (cur + d >= maxDuration - 0.7) break;
      cur += d;
      synth.push(Math.round(cur * 100) / 100);
    }
    return synth;
  }
  return cuts;
}

async function sampleFrames(
  videoPath: string,
  timestamps: number[],
  workDir: string,
): Promise<Array<{ atSeconds: number; base64Jpeg: string }>> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return [];
  const frames: Array<{ atSeconds: number; base64Jpeg: string }> = [];
  let i = 0;
  for (const t of timestamps) {
    const out = path.join(workDir, `frame-${String(i).padStart(2, "0")}.jpg`);
    try {
      await execFileAsync(ffmpeg, [
        "-y",
        "-ss",
        Math.max(0, t).toFixed(3),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=512:-2",
        "-q:v",
        "6",
        out,
      ]);
      const buf = await fs.readFile(out);
      frames.push({ atSeconds: t, base64Jpeg: buf.toString("base64") });
      await fs.unlink(out).catch(() => undefined);
    } catch {
      /* skip failed frame */
    }
    i++;
  }
  return frames;
}

function buildAnalysisFromFeatures(opts: {
  durationSeconds: number;
  sceneCuts: number[];
  aiAnalysis: Awaited<ReturnType<typeof analyzeReel>>["analysis"];
  aiUsed: boolean;
  hasVoice: boolean;
  meanColorRef: { r: number; g: number; b: number } | null;
}): ReelAnalysis {
  const { durationSeconds, sceneCuts, aiAnalysis, aiUsed, hasVoice, meanColorRef } = opts;
  const shotCount = sceneCuts.length + 1;
  const beats = beatsForCount(aiAnalysis.structureBeats.length || shotCount);
  const structureBeats =
    aiAnalysis.structureBeats.length > 0 ? aiAnalysis.structureBeats : beats;
  const shotHints =
    aiAnalysis.shotHints.length > 0
      ? aiAnalysis.shotHints
      : beatsForCount(structureBeats.length).map(() => "");

  const colorMood =
    aiAnalysis.colorMood ||
    (meanColorRef
      ? `rgb(${meanColorRef.r},${meanColorRef.g},${meanColorRef.b}) toned`
      : "balanced");

  return {
    durationSeconds,
    sceneCuts,
    hook: aiAnalysis.hook,
    vibe: aiAnalysis.vibe,
    colorMood,
    captionStyle: aiAnalysis.captionStyle,
    structureBeats,
    shotHints,
    pacing: {
      cutsPer10s: Math.round((sceneCuts.length / Math.max(1, durationSeconds)) * 10 * 10) / 10,
      avgShotSeconds: Math.round((durationSeconds / Math.max(1, shotCount)) * 100) / 100,
    },
    hasVoice,
    aiUsed,
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — build the edit plan
// ---------------------------------------------------------------------------

function scaleCutsToTarget(cuts: number[], refDuration: number, target: number): number[] {
  if (refDuration <= 0) return [];
  const ratio = target / refDuration;
  return cuts.map((c) => Math.round(c * ratio * 100) / 100).filter((c) => c > 0.4 && c < target - 0.4);
}

export async function buildEditPlan(opts: {
  analysis: ReelAnalysis;
  clips: LibraryClip[];
  clipPaths: Map<string, string>;
  targetDuration: number;
  refColor?: { r: number; g: number; b: number } | null;
}): Promise<EditPlan> {
  const { analysis, clips, targetDuration } = opts;

  // Cut points scaled from reference pacing to the target length
  const cuts = scaleCutsToTarget(analysis.sceneCuts, analysis.durationSeconds, targetDuration);
  const boundaries = [0, ...cuts, targetDuration].sort((a, b) => a - b);

  // Drop degenerate shots
  const rawShots: Array<{ startAt: number; durationSeconds: number }> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const dur = boundaries[i + 1] - boundaries[i];
    if (dur >= 0.5) rawShots.push({ startAt: boundaries[i], durationSeconds: dur });
  }
  if (rawShots.length === 0) {
    rawShots.push({ startAt: 0, durationSeconds: targetDuration });
  }

  const beats = beatsForCount(rawShots.length);
  // Prefer AI structure beats if they match the shot count closely
  const structure = analysis.structureBeats;
  const finalBeats: RecreateBeat[] = rawShots.map((_, i) =>
    structure.length === rawShots.length ? structure[i] : beats[i],
  );

  const shotSeeds = rawShots.map((s, i) => ({
    index: i,
    beat: finalBeats[i],
    durationSeconds: Math.round(s.durationSeconds * 100) / 100,
    startAt: Math.round(s.startAt * 100) / 100,
    sourceHint: analysis.shotHints[i] || finalBeats[i],
  }));

  const refColor = opts.refColor ?? (await extractMeanColorFromAnalysis(analysis));
  const { planShots: assignments, aiUsed } = await planShots({
    analysis,
    shots: shotSeeds,
    clips,
    targetDuration,
    refColor,
  });

  // Resolve in-points: pick each clip's most active (liveliest) window that
  // doesn't overlap moments already used from the same clip.
  const shots: ShotPlan[] = [];
  const usedWindows = new Map<string, Array<{ start: number; end: number }>>();
  for (const seed of shotSeeds) {
    const assign = assignments.find((a) => a.index === seed.index);
    let clipAssignment: ShotPlan["clip"] = null;

    const ci = assign?.clipIndex;
    if (ci !== null && ci !== undefined && clips[ci]) {
      const clip = clips[ci];
      const clipPath = opts.clipPaths.get(clip.id);
      const dur = seed.durationSeconds;
      const events = clipPath
        ? await loadClipActivity(clip.id, clipPath, clip.durationSeconds).catch(() => [])
        : [];
      const used = usedWindows.get(clip.id) ?? [];
      const win =
        clipPath && clip.durationSeconds > 0
          ? pickBestWindow({
              clipLength: clip.durationSeconds,
              want: dur,
              events,
              used,
            })
          : { start: 0, end: Math.min(dur, clip.durationSeconds), stretch: 1 };
      used.push({ start: win.start, end: win.end });
      usedWindows.set(clip.id, used);
      clipAssignment = {
        libraryClipId: clip.id,
        clipName: clip.name,
        sourceStart: Math.round(win.start * 1000) / 1000,
        sourceEnd: Math.round(win.end * 1000) / 1000,
      };
    }

    shots.push({
      index: seed.index,
      beat: seed.beat,
      durationSeconds: seed.durationSeconds,
      startAt: seed.startAt,
      captionText: assign?.captionText?.trim() || "",
      clip: clipAssignment,
      sourceHint: seed.sourceHint,
    });
  }

  // If no clips matched at all (empty library edge case), leave nulls — caller validates.
  return {
    targetDuration,
    shots,
    captionPosition: analysis.captionStyle.position,
    captionEnergy: analysis.captionStyle.energy,
    aiUsed: analysis.aiUsed || aiUsed,
  };
}

async function extractMeanColorFromAnalysis(
  analysis: ReelAnalysis,
): Promise<{ r: number; g: number; b: number } | null> {
  // Parse "rgb(r,g,b) toned" if present, else null (color match disabled)
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(analysis.colorMood);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  return null;
}

// ---------------------------------------------------------------------------
// Stage 4 — captions (ASS) + audio
// ---------------------------------------------------------------------------

function fmtAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function buildAssCaptions(plan: EditPlan): string {
  const fontSize = plan.captionEnergy === "hype" ? 72 : plan.captionEnergy === "chill" ? 56 : 64;
  const alignment = plan.captionPosition === "top" ? 8 : plan.captionPosition === "center" ? 5 : 2;
  const marginV = plan.captionPosition === "bottom" ? 180 : plan.captionPosition === "top" ? 160 : 0;
  const lines: string[] = [];
  for (const shot of plan.shots) {
    const text = shot.captionText.replace(/[{}\\]/g, "").trim();
    if (!text) continue;
    const start = shot.startAt + 0.15;
    const end = shot.startAt + shot.durationSeconds - 0.1;
    if (end - start < 0.3) continue;
    lines.push(
      `Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Default,,0,0,0,,${text.toUpperCase()}`,
    );
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H96000000,1,0,0,0,100,100,1,0,1,5,2,${alignment},80,80,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines,
    "",
  ].join("\n");
}

async function extractReferenceAudio(
  referencePath: string,
  outPath: string,
  targetDuration: number,
): Promise<void> {
  const fadeStart = Math.max(0, targetDuration - 1.2);
  await runFfmpeg([
    "-y",
    "-i",
    referencePath,
    "-t",
    targetDuration.toFixed(2),
    "-vn",
    "-af",
    `afade=t=out:st=${fadeStart.toFixed(2)}:d=1.2`,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    outPath,
  ]);
}

// ---------------------------------------------------------------------------
// Stage 5 — deterministic render
// ---------------------------------------------------------------------------

export type RecreateRenderInput = {
  plan: EditPlan;
  clipPaths: Map<string, string>;
  audioPath: string;
  workDir: string;
  outputFile: string;
  /** Master switch for caption burn + SRT sidecar (default true). */
  includeCaptions?: boolean;
  onProgress?: (detail: string, pct: number) => void;
};

export async function renderRecreatedReel(input: RecreateRenderInput): Promise<{
  durationSeconds: number;
  shotsCount: number;
  clipsUsed: string[];
}> {
  const { plan, clipPaths, audioPath, workDir, outputFile } = input;
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.dirname(outputFile), { recursive: true });

  const isMac = process.platform === "darwin";
  const videoCodecArgs = isMac
    ? ["-c:v", "h264_videotoolbox", "-b:v", "8000k"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];

  // 1. Normalize each shot to 1080x1920 silent video
  const shotFiles: string[] = [];
  const clipsUsed = new Set<string>();
  for (let i = 0; i < plan.shots.length; i++) {
    const shot = plan.shots[i];
    const out = path.join(workDir, `shot-${String(i).padStart(3, "0")}.mp4`);
    input.onProgress?.(
      `Cutting shot ${i + 1}/${plan.shots.length}${shot.clip ? ` from ${shot.clip.clipName}` : ""}…`,
      30 + Math.round(((i + 1) / plan.shots.length) * 40),
    );

    if (!shot.clip) {
      // No clip assigned — solid color placeholder so the reel still completes
      await runFfmpeg([
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x101014:s=1080x1920:d=${shot.durationSeconds.toFixed(3)}:r=30`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        out,
      ]);
      shotFiles.push(out);
      continue;
    }

    const clipPath = clipPaths.get(shot.clip.libraryClipId);
    if (!clipPath) {
      shotFiles.push(out);
      continue;
    }
    clipsUsed.add(shot.clip.clipName);

    const ss = shot.clip.sourceStart.toFixed(3);
    const avail = Math.max(0.3, shot.clip.sourceEnd - shot.clip.sourceStart);
    const want = Math.max(0.3, shot.durationSeconds);
    // Slow-down stretch: when the source window is shorter than the shot
    // (short library clip), stretch PTS so it fills the shot duration.
    const stretch = Math.min(2, Math.max(1, want / avail));
    // `-t` limits OUTPUT time (post-filter), so it must be the desired output
    // duration: stretched = avail*factor, normal = the window length.
    const outDur = avail > want ? want : avail * stretch;
    const filterChain = [
      "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos",
      "crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2",
      "setsar=1",
      stretch > 1.01 ? `setpts=PTS*${stretch.toFixed(4)}` : null,
      "fps=30",
    ]
      .filter(Boolean)
      .join(",");
    await runFfmpeg([
      "-y",
      "-ss",
      ss,
      "-i",
      clipPath,
      "-t",
      outDur.toFixed(3),
      "-vf",
      filterChain,
      "-an",
      ...videoCodecArgs,
      "-pix_fmt",
      "yuv420p",
      out,
    ]);
    shotFiles.push(out);
  }

  // 2. Concat all shots
  input.onProgress?.("Splicing shots together…", 72);
  const listFile = path.join(workDir, "concat.txt");
  await fs.writeFile(
    listFile,
    shotFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  const concatFile = path.join(workDir, "concat.mp4");
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    concatFile,
  ]);

  // 3. Burn captions (if enabled & any): libass when available, Pillow PNG overlay otherwise.
  //    An SRT sidecar is written alongside so captions can be toggled later.
  const hasCaptions = input.includeCaptions !== false && plan.shots.some((s) => s.captionText.trim());
  let captionedFile = concatFile;
  if (hasCaptions) {
    input.onProgress?.("Burning in captions…", 82);
    captionedFile = path.join(workDir, "captioned.mp4");
    let burned = false;
    if (await supportsAssFilter()) {
      const assPath = path.join(workDir, "captions.ass");
      await fs.writeFile(assPath, buildAssCaptions(plan), "utf8");
      await runFfmpeg(
        ["-y", "-i", concatFile, "-vf", "ass=captions.ass", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-an", captionedFile],
        { cwd: workDir },
      );
      burned = true;
    } else if (await supportsPillow()) {
      const pngItems = await renderCaptionPngs(plan, workDir);
      if (pngItems.length > 0) {
        await burnPngCaptions({
          inputVideo: concatFile,
          items: pngItems,
          workDir,
          outputFile: captionedFile,
        });
        burned = true;
      }
    }
    if (!burned) captionedFile = concatFile;
  }

  // 4. Mux the reference trending audio
  input.onProgress?.("Laying down the trending soundtrack…", 90);
  await runFfmpeg([
    "-y",
    "-i",
    captionedFile,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputFile,
  ]);

  // 5. Cleanup intermediates
  if (hasCaptions) {
    await fs
      .writeFile(path.join(path.dirname(outputFile), "reel.srt"), buildSrt(plan), "utf8")
      .catch(() => undefined);
  }
  await Promise.all(shotFiles.map((p) => fs.unlink(p).catch(() => undefined)));
  await fs.unlink(listFile).catch(() => undefined);
  await fs.unlink(concatFile).catch(() => undefined);
  if (captionedFile !== concatFile) await fs.unlink(captionedFile).catch(() => undefined);
  await fs.unlink(path.join(workDir, "captions.ass")).catch(() => undefined);
  await fs.unlink(path.join(workDir, "captions-spec.json")).catch(() => undefined);
  const workEntries = await fs.readdir(workDir).catch(() => [] as string[]);
  await Promise.all(
    workEntries
      .filter((e) => e.startsWith("cap-") && e.endsWith(".png"))
      .map((e) => fs.unlink(path.join(workDir, e)).catch(() => undefined)),
  );

  const probe = await probeMedia(outputFile);
  input.onProgress?.("Ready", 100);
  return {
    durationSeconds: probe.durationSeconds,
    shotsCount: plan.shots.length,
    clipsUsed: Array.from(clipsUsed),
  };
}

// ---------------------------------------------------------------------------
// Full orchestration
// ---------------------------------------------------------------------------

export type RunRecreateInput = {
  id: string;
  referenceUrl: string;
  targetDuration: number;
  clips: LibraryClip[];
  clipPaths: Map<string, string>;
  jobDir: string;
  workDir: string;
  /** Master switch for caption burn + SRT sidecar (default true). */
  includeCaptions?: boolean;
  onProgress: (patch: {
    status?:
      | "downloading"
      | "analyzing"
      | "planning"
      | "rendering"
      | "ready"
      | "error";
    progress?: number;
    detail?: string;
    analysis?: ReelAnalysis;
    plan?: EditPlan;
    referenceTitle?: string | null;
    error?: string | null;
  }) => Promise<void>;
};

export async function runRecreateJob(input: RunRecreateInput): Promise<{
  fileName: string;
  durationSeconds: number;
  shotsCount: number;
  clipsUsed: string[];
}> {
  const { jobDir, workDir, targetDuration, clips, clipPaths } = input;

  // Stage 1 — download reference
  await input.onProgress({
    status: "downloading",
    progress: 5,
    detail: "Downloading the reference reel…",
  });
  const { filePath: referencePath, title } = await downloadReference(
    input.referenceUrl,
    jobDir,
    (pct) => {
      void input.onProgress({
        progress: 5 + Math.round(pct * 0.15),
        detail: `Downloading reference reel… ${pct}%`,
      });
    },
  );
  await input.onProgress({ referenceTitle: title ?? null });

  const refProbe = await probeMedia(referencePath);
  const effectiveDuration = Math.min(refProbe.durationSeconds, Math.max(targetDuration, 15));

  // Stage 2 — features + analysis
  await input.onProgress({
    status: "analyzing",
    progress: 24,
    detail: "Detecting scene cuts & pacing…",
  });
  const sceneCuts = await detectSceneCuts(referencePath, effectiveDuration);

  await input.onProgress({ progress: 30, detail: "Sampling keyframes for AI vision…" });
  const frameTs = [0.4, ...sceneCuts.map((c) => c + 0.2)].filter((t) => t < effectiveDuration);
  const uniqueTs = Array.from(new Set(frameTs.map((t) => Math.round(t * 10) / 10)))
    .sort((a, b) => a - b)
    .slice(0, 7);
  const frames = await sampleFrames(referencePath, uniqueTs, workDir);

  const meanColorRef = await extractMeanColor(referencePath, Math.min(1, effectiveDuration / 2));

  await input.onProgress({ progress: 38, detail: "Reading the reel's DNA (hook, vibe, structure)…" });
  const { analysis: aiAnalysis, aiUsed } = await analyzeReel({
    durationSeconds: effectiveDuration,
    sceneCuts,
    hasVoice: refProbe.hasAudio,
    frames,
  });

  const analysis = buildAnalysisFromFeatures({
    durationSeconds: effectiveDuration,
    sceneCuts,
    aiAnalysis,
    aiUsed,
    hasVoice: refProbe.hasAudio,
    meanColorRef,
  });
  await input.onProgress({ analysis, progress: 45, detail: "Reel DNA extracted." });

  // Stage 3 — plan
  await input.onProgress({
    status: "planning",
    progress: 48,
    detail: "Matching your library clips to each shot…",
  });
  const plan = await buildEditPlan({
    analysis,
    clips,
    clipPaths,
    targetDuration: effectiveDuration,
    refColor: meanColorRef,
  });

  const assigned = plan.shots.filter((s) => s.clip).length;
  if (assigned === 0 && clips.length > 0) {
    // Force round-robin assignment as a last resort
    for (let i = 0; i < plan.shots.length; i++) {
      const clip = clips[i % clips.length];
      const dur = Math.min(plan.shots[i].durationSeconds, clip.durationSeconds);
      const start = Math.max(0, Math.min(0.5, Math.max(0, clip.durationSeconds - dur)));
      plan.shots[i].clip = {
        libraryClipId: clip.id,
        clipName: clip.name,
        sourceStart: start,
        sourceEnd: Math.min(clip.durationSeconds, start + dur),
      };
    }
  }

  await input.onProgress({ plan, progress: 55, detail: "Edit plan ready." });

  // Stage 4 — audio
  await input.onProgress({ progress: 58, detail: "Extracting the trending audio track…" });
  const audioPath = path.join(workDir, "soundtrack.m4a");
  await extractReferenceAudio(referencePath, audioPath, effectiveDuration);

  // Stage 5 — render
  await input.onProgress({
    status: "rendering",
    progress: 60,
    detail: "Rendering your recreated reel…",
  });
  const outputFile = path.join(jobDir, "reel.mp4");
  const result = await renderRecreatedReel({
    plan,
    clipPaths,
    audioPath,
    workDir,
    outputFile,
    includeCaptions: input.includeCaptions,
    onProgress: (detail, pct) => {
      void input.onProgress({ progress: 60 + Math.round(pct * 0.4), detail });
    },
  });

  await input.onProgress({
    status: "ready",
    progress: 100,
    detail: "Ready!",
  });

  return { fileName: "reel.mp4", ...result };
}
