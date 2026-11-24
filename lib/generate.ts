import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { detectAiProvider, generateJson } from "./ai";
import { resolveFfmpeg, resolveSay } from "./binaries";
import { burnPngCaptions, renderCaptionPngs, supportsPillow } from "./captions";
import { probeMedia } from "./media";
import type {
  EditPlan,
  GenerateShotlist,
  GenerateStyle,
  GeneratedShot,
  RecreateBeat,
} from "./types";

const execFileAsync = promisify(execFile);

type StylePreset = {
  colors: [string, string, string, string];
  gradientType: number;
  speed: number;
  accent: string;
  eq: string;
  voice: string;
  visualHints: string[];
};

const STYLE_PRESETS: Record<GenerateStyle, StylePreset> = {
  "cinematic-warm": {
    colors: ["0x24150E", "0x6B3410", "0xC9762E", "0xFFD9A0"],
    gradientType: 1,
    speed: 0.02,
    accent: "0xFFB347@0.12",
    eq: "eq=contrast=1.12:saturation=1.08:brightness=-0.02",
    voice: "Samantha",
    visualHints: [
      "warm light spilling across a quiet frame",
      "slow drift through amber haze",
      "close study of texture in golden light",
      "soft silhouettes against a glowing horizon",
    ],
  },
  documentary: {
    colors: ["0x0B1418", "0x1F3A44", "0x56808C", "0xBFD4D9"],
    gradientType: 0,
    speed: 0.012,
    accent: "0x7FB7C4@0.10",
    eq: "eq=contrast=1.05:saturation=0.92",
    voice: "Alex",
    visualHints: [
      "clean natural light on an open scene",
      "steady observation of a quiet detail",
      "cool daylight shifting across the frame",
      "wide context view with gentle motion",
    ],
  },
  "modern-minimal": {
    colors: ["0x0A0A0B", "0x202024", "0x5A5A60", "0xF2F2F0"],
    gradientType: 2,
    speed: 0.008,
    accent: "0xF2F2F0@0.08",
    eq: "eq=contrast=1.08:saturation=0.55",
    voice: "Samantha",
    visualHints: [
      "a single shape moving through negative space",
      "monochrome light study with soft edges",
      "precise geometry in slow motion",
      "quiet gradient fading into stillness",
    ],
  },
};

function splitScript(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•\d.)\s]+/, ""))
    .filter((line) => line.length >= 3);
  if (lines.length >= 3) return lines;
  const sentences = prompt
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return sentences.length >= 2 ? sentences : [prompt.trim()];
}

function shortText(text: string, max = 52): string {
  const clean = text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function captionFor(text: string): string {
  const words = shortText(text, 200).split(" ").slice(0, 7).join(" ");
  return shortText(words);
}

type ShotDraft = { visual: string; narration: string; caption: string };

function layoutShots(drafts: ShotDraft[], duration: number): GeneratedShot[] {
  const count = drafts.length;
  const weights = drafts.map((_, i) => (i === 0 ? 1.25 : i === count - 1 ? 1.1 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let startAt = 0;
  const shots: GeneratedShot[] = drafts.map((draft, i) => {
    const dur = Math.round((duration * weights[i] * 100) / total) / 100;
    const shot: GeneratedShot = {
      index: i,
      startAt: Math.round(startAt * 100) / 100,
      durationSeconds: dur,
      visual: shortText(draft.visual, 120),
      narration: shortText(draft.narration, 240),
      caption: captionFor(draft.caption || draft.narration),
    };
    startAt += dur;
    return shot;
  });
  if (shots.length > 0) {
    const drift = duration - startAt;
    const last = shots[shots.length - 1];
    last.durationSeconds = Math.max(0.4, Math.round((last.durationSeconds + drift) * 100) / 100);
  }
  return shots;
}

function heuristicDrafts(prompt: string, style: GenerateStyle, count: number): ShotDraft[] {
  const preset = STYLE_PRESETS[style];
  const lines = splitScript(prompt);
  return Array.from({ length: count }, (_, i) => {
    const narration = lines[i % lines.length];
    return {
      visual: preset.visualHints[i % preset.visualHints.length],
      narration,
      caption: captionFor(narration),
    };
  });
}

export type PlanVideoInput = {
  prompt: string;
  style: GenerateStyle;
  targetDuration: number;
};

export async function planVideo(input: PlanVideoInput): Promise<{
  shotlist: GenerateShotlist;
  aiUsed: boolean;
}> {
  const count = Math.max(3, Math.min(10, Math.round(input.targetDuration / 3.2)));
  const lines = splitScript(input.prompt);
  const fallback: GenerateShotlist = {
    title: shortText(lines[0] ?? input.prompt, 60),
    style: input.style,
    targetDuration: input.targetDuration,
    shots: layoutShots(heuristicDrafts(input.prompt, input.style, count), input.targetDuration),
    aiUsed: false,
  };

  if (detectAiProvider() === "none") return { shotlist: fallback, aiUsed: false };

  const { data } = await generateJson(`You are a cinematic director writing a short vertical video plan.
Creator concept or script:
"""
${input.prompt.slice(0, 4000)}
"""
Target length: ${input.targetDuration} seconds. Visual style: ${input.style}.
Respond with ONLY valid JSON in this exact shape:
{
  "title": "short title, max 60 characters",
  "shots": [
    { "visual": "one short sentence describing the imagery of this scene", "narration": "the voiceover line for this scene", "caption": "max 7 words for on-screen text" }
  ]
}
Write between ${Math.max(3, count - 1)} and ${Math.min(12, count + 2)} shots. Each narration line should be a natural sentence, under 25 words. Do not add markdown.`);

  if (!data || typeof data !== "object") return { shotlist: fallback, aiUsed: false };
  const parsed = data as { title?: unknown; shots?: unknown };
  if (!Array.isArray(parsed.shots)) return { shotlist: fallback, aiUsed: false };
  const drafts: ShotDraft[] = [];
  for (const raw of parsed.shots.slice(0, 12)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { visual?: unknown; narration?: unknown; caption?: unknown };
    const narration = String(item.narration ?? "").trim();
    const visual = String(item.visual ?? "").trim();
    if (!narration && !visual) continue;
    drafts.push({
      visual: visual || fallback.shots[drafts.length]?.visual || "abstract cinematic motion",
      narration: narration || String(lines[drafts.length % lines.length] ?? ""),
      caption: String(item.caption ?? "").trim(),
    });
  }
  if (drafts.length < 3) return { shotlist: fallback, aiUsed: false };

  return {
    shotlist: {
      title: shortText(String(parsed.title ?? "").trim() || fallback.title, 60),
      style: input.style,
      targetDuration: input.targetDuration,
      shots: layoutShots(drafts, input.targetDuration),
      aiUsed: true,
    },
    aiUsed: true,
  };
}

function runFfmpeg(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void resolveFfmpeg().then((ffmpeg) => {
      if (!ffmpeg) {
        reject(new Error("FFmpeg is not installed."));
        return;
      }
      execFile(
        ffmpeg,
        args,
        { maxBuffer: 32 * 1024 * 1024, cwd },
        (err) => (err ? reject(new Error(`ffmpeg failed: ${err.message}`)) : resolve()),
      );
    }, reject);
  });
}

export type RenderGeneratedInput = {
  shotlist: GenerateShotlist;
  workDir: string;
  outputFile: string;
  includeNarration: boolean;
  includeAmbient: boolean;
  includeCaptions: boolean;
  onProgress?: (detail: string, pct: number) => void;
};

export async function renderGeneratedVideo(input: RenderGeneratedInput): Promise<{
  durationSeconds: number;
  shotsCount: number;
  narrationUsed: boolean;
  narrationNote: string | null;
  captionsBurned: boolean;
}> {
  const { shotlist, workDir, outputFile } = input;
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const preset = STYLE_PRESETS[shotlist.style] ?? STYLE_PRESETS["cinematic-warm"];
  const isMac = process.platform === "darwin";
  const videoCodecArgs = isMac
    ? ["-c:v", "h264_videotoolbox", "-b:v", "6000k"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];

  const segmentFiles: string[] = [];
  for (let i = 0; i < shotlist.shots.length; i++) {
    const shot = shotlist.shots[i];
    input.onProgress?.(
      `Painting scene ${i + 1}/${shotlist.shots.length}…`,
      20 + Math.round(((i + 1) / shotlist.shots.length) * 45),
    );
    const out = path.join(workDir, `scene-${String(i).padStart(3, "0")}.mp4`);
    const source = [
      "gradients=s=1080x1920:rate=30",
      `c0=${preset.colors[0]}`,
      `c1=${preset.colors[1]}`,
      `c2=${preset.colors[2]}`,
      `c3=${preset.colors[3]}`,
      "nb_colors=4",
      `type=${preset.gradientType}`,
      `speed=${preset.speed}`,
      `seed=${i * 17 + 7}`,
      `duration=${shot.durationSeconds.toFixed(3)}`,
    ].join(":");
    const filter = [
      preset.eq,
      "noise=alls=6:allf=t+u",
      "vignette=PI/5",
      `drawbox=x=(540+${360 + i * 18}*sin(t*${(0.4 + i * 0.07).toFixed(3)})):y=(960+420*cos(t*${(0.33 + i * 0.05).toFixed(3)})):w=460:h=460:color=${preset.accent}:t=fill`,
      "format=yuv420p",
    ].join(",");
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      source,
      "-t",
      shot.durationSeconds.toFixed(3),
      "-vf",
      filter,
      "-an",
      ...videoCodecArgs,
      out,
    ]);
    segmentFiles.push(out);
  }

  input.onProgress?.("Joining scenes…", 68);
  const listFile = path.join(workDir, "scenes.txt");
  await fs.writeFile(
    listFile,
    segmentFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  const joinedFile = path.join(workDir, "joined.mp4");
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
    joinedFile,
  ]);

  let videoFile = joinedFile;
  let captionsBurned = false;
  if (input.includeCaptions && (await supportsPillow())) {
    input.onProgress?.("Painting captions…", 76);
    const captionPlan: EditPlan = {
      targetDuration: shotlist.targetDuration,
      shots: shotlist.shots.map((shot) => ({
        index: shot.index,
        beat: "setup" as RecreateBeat,
        durationSeconds: shot.durationSeconds,
        startAt: shot.startAt,
        captionText: shot.caption,
        clip: null,
        sourceHint: shot.visual,
      })),
      captionPosition: "bottom",
      captionEnergy: "punchy",
      aiUsed: shotlist.aiUsed,
    };
    const items = await renderCaptionPngs(captionPlan, workDir);
    if (items.length > 0) {
      const captionedFile = path.join(workDir, "captioned.mp4");
      await burnPngCaptions({ inputVideo: joinedFile, items, workDir, outputFile: captionedFile });
      videoFile = captionedFile;
      captionsBurned = true;
    }
  }

  const audioInputs: string[] = [];
  let narrationNote: string | null = null;
  if (input.includeNarration) {
    input.onProgress?.("Recording narration…", 82);
    const say = await resolveSay();
    if (say) {
      const narrationFiles: string[] = [];
      for (const shot of shotlist.shots) {
        const aiff = path.join(workDir, `voice-${String(shot.index).padStart(3, "0")}.aiff`);
        const m4a = path.join(workDir, `voice-${String(shot.index).padStart(3, "0")}.m4a`);
        try {
          await execFileAsync(say, ["-v", preset.voice, "-o", aiff, "--", shot.narration], {
            timeout: 20000,
          });
          await runFfmpeg([
            "-y",
            "-i",
            aiff,
            "-af",
            "apad",
            "-t",
            shot.durationSeconds.toFixed(3),
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            m4a,
          ]);
          narrationFiles.push(m4a);
        } catch {
          narrationNote = "Narration could not be recorded for every scene.";
        }
        await fs.unlink(aiff).catch(() => undefined);
      }
      if (narrationFiles.length > 0) {
        const narrationList = path.join(workDir, "voice.txt");
        await fs.writeFile(
          narrationList,
          narrationFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
          "utf8",
        );
        const narrationFile = path.join(workDir, "narration.m4a");
        await runFfmpeg([
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          narrationList,
          "-c",
          "copy",
          narrationFile,
        ]);
        audioInputs.push(narrationFile);
      } else {
        narrationNote = "No local voice was available; the video was rendered without narration.";
      }
    } else {
      narrationNote = "No local speech engine found; the video was rendered without narration.";
    }
  }

  const narrationUsed = audioInputs.length > 0;
  if (input.includeAmbient) {
    input.onProgress?.("Mixing ambient bed…", 90);
    const ambientFile = path.join(workDir, "ambient.m4a");
    const fadeStart = Math.max(0, shotlist.targetDuration - 1.5);
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=c=pink:a=0.05:d=${shotlist.targetDuration.toFixed(3)},lowpass=f=700,afade=t=in:st=0:d=1,afade=t=out:st=${fadeStart.toFixed(2)}:d=1.5`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      ambientFile,
    ]);
    audioInputs.unshift(ambientFile);
  }

  input.onProgress?.("Finalizing video…", 94);
  if (audioInputs.length === 0) {
    await runFfmpeg(["-y", "-i", videoFile, "-c", "copy", outputFile]);
  } else if (audioInputs.length === 1) {
    await runFfmpeg([
      "-y",
      "-i",
      videoFile,
      "-i",
      audioInputs[0],
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
  } else {
    await runFfmpeg([
      "-y",
      "-i",
      videoFile,
      "-i",
      audioInputs[0],
      "-i",
      audioInputs[1],
      "-filter_complex",
      "[1:a]volume=0.30[amb];[2:a]volume=1.0[voice];[amb][voice]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]",
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
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
  }

  const probe = await probeMedia(outputFile);
  await Promise.all(segmentFiles.map((p) => fs.unlink(p).catch(() => undefined)));
  await fs.unlink(listFile).catch(() => undefined);
  await fs.unlink(joinedFile).catch(() => undefined);
  if (videoFile !== joinedFile) await fs.unlink(videoFile).catch(() => undefined);
  for (const file of audioInputs) await fs.unlink(file).catch(() => undefined);
  await fs.unlink(path.join(workDir, "voice.txt")).catch(() => undefined);
  const workEntries = await fs.readdir(workDir).catch(() => [] as string[]);
  await Promise.all(
    workEntries
      .filter((e) => e.startsWith("cap-") && e.endsWith(".png"))
      .map((e) => fs.unlink(path.join(workDir, e)).catch(() => undefined)),
  );
  await fs.unlink(path.join(workDir, "captions-spec.json")).catch(() => undefined);

  return {
    durationSeconds: probe.durationSeconds,
    shotsCount: shotlist.shots.length,
    narrationUsed,
    narrationNote,
    captionsBurned,
  };
}
