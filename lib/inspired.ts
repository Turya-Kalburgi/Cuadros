import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { resolveFfmpeg } from "./binaries";
import { probeMedia } from "./media";

const execFileAsync = promisify(execFile);

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    resolveFfmpeg().then((ffmpeg) => {
      if (!ffmpeg) {
        reject(new Error("ffmpeg not found."));
        return;
      }
      const child = execFile(ffmpeg, args, { maxBuffer: 32 * 1024 * 1024 }, (err) => {
        if (err) reject(new Error(`ffmpeg failed: ${err.message}`));
        else resolve();
      });
    });
  });
}

export type InspiredCutSlot = {
  index: number;
  start: number;
  duration: number;
  sourceClipName: string;
};

export type InspiredReelResult = {
  id: string;
  reelPath: string;
  outputFileName: string;
  durationSeconds: number;
  cutsCount: number;
  slots: InspiredCutSlot[];
  inspiredTitle: string;
  inspiredDuration: number;
};

/**
 * Detects scene cut timestamps from the inspiration video using FFmpeg.
 * Falls back to a dynamic cinematic rhythm if scene detection yields few cuts.
 */
export async function detectSceneCuts(
  videoPath: string,
  targetDuration: number,
): Promise<number[]> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg not found");

  const cuts: number[] = [];
  try {
    const { stderr } = await execFileAsync(ffmpeg, [
      "-i",
      videoPath,
      "-t",
      targetDuration.toFixed(2),
      "-vf",
      "select='gt(scene,0.22)',showinfo",
      "-f",
      "null",
      "-",
    ]);

    const regex = /pts_time:([0-9.]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(stderr)) !== null) {
      const t = parseFloat(match[1]);
      if (Number.isFinite(t) && t > 0.6 && t < targetDuration - 0.5) {
        // Only keep cuts that are at least 0.8s apart from previous
        if (cuts.length === 0 || t - cuts[cuts.length - 1] >= 0.8) {
          cuts.push(Math.round(t * 100) / 100);
        }
      }
    }
  } catch {
    // If detection failed or timed out, we fall back to rhythmic cadence
  }

  // If cuts are sparse (< 4 cuts), synthesize a cinematic rhythmic pattern
  if (cuts.length < 4) {
    const rhythmicDurations = [2.2, 1.6, 1.4, 2.0, 1.8, 1.2, 2.4, 1.9, 1.5, 2.1, 1.7, 2.3, 1.8, 2.0, 2.5, 1.8];
    const synthCuts: number[] = [];
    let cur = 0;
    for (const d of rhythmicDurations) {
      if (cur + d >= targetDuration - 0.8) break;
      cur += d;
      synthCuts.push(Math.round(cur * 100) / 100);
    }
    return synthCuts;
  }

  return cuts;
}

/**
 * Extracts and prepares the audio track from the inspiration video,
 * applying a smooth fade-out at the target duration.
 */
export async function extractInspiredAudio(
  videoPath: string,
  outputPath: string,
  targetDuration: number,
): Promise<void> {
  const fadeStart = Math.max(0, targetDuration - 1.2);
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
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
    outputPath,
  ]);
}

/**
 * Generates an Inspired Reel matching the cut pacing and audio of the inspiration video.
 */
export async function generateInspiredReel(opts: {
  id: string;
  userClips: Array<{ filePath: string; name: string }>;
  inspiredVideoPath: string;
  inspiredTitle: string;
  targetDuration: number; // e.g. 30 or 40
  workDir: string;
  outputFile: string;
  onProgress?: (step: string, pct: number) => void;
}): Promise<InspiredReelResult> {
  const { id, userClips, inspiredVideoPath, inspiredTitle, targetDuration, workDir, outputFile, onProgress } = opts;

  await fs.mkdir(workDir, { recursive: true });

  onProgress?.("Analyzing inspiration video pacing and scene cuts…", 10);
  const cutPoints = await detectSceneCuts(inspiredVideoPath, targetDuration);

  // Turn cut points [t1, t2, ...] into shot durations
  const shotDurations: number[] = [];
  let prev = 0;
  for (const cut of cutPoints) {
    const dur = Math.max(0.5, cut - prev);
    shotDurations.push(dur);
    prev = cut;
  }
  if (prev < targetDuration) {
    shotDurations.push(Math.max(0.5, targetDuration - prev));
  }

  onProgress?.("Extracting audio and song from inspiration video…", 25);
  const extractedAudioPath = path.join(workDir, "inspired-audio.m4a");
  await extractInspiredAudio(inspiredVideoPath, extractedAudioPath, targetDuration);

  // Probe user clips to know their durations
  onProgress?.("Inspecting your footage…", 35);
  const userProbes = await Promise.all(
    userClips.map(async (c) => {
      const probe = await probeMedia(c.filePath);
      return { ...c, duration: probe.durationSeconds };
    }),
  );

  const isMac = process.platform === "darwin";
  const videoCodecArgs = isMac
    ? ["-c:v", "h264_videotoolbox", "-b:v", "7000k"]
    : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "22"];

  const sliceParts: string[] = [];
  const slots: InspiredCutSlot[] = [];
  let timelinePos = 0;

  // Track offset per user clip so we don't start from 0 every time
  const clipOffsets: Record<string, number> = {};
  for (const c of userProbes) clipOffsets[c.filePath] = 0.5;

  onProgress?.(`Cutting ${shotDurations.length} shots to match the inspired rhythm…`, 45);

  for (let i = 0; i < shotDurations.length; i++) {
    const dur = shotDurations[i];
    // Round-robin pick user clip
    const chosenClip = userProbes[i % userProbes.length];
    let startOffset = clipOffsets[chosenClip.filePath] ?? 0;

    // Wrap around if offset exceeds clip duration
    if (startOffset + dur > chosenClip.duration - 0.5) {
      startOffset = (i * 1.5) % Math.max(0.2, chosenClip.duration - dur);
    }
    clipOffsets[chosenClip.filePath] = startOffset + dur + 0.5;

    const slicePath = path.join(workDir, `shot-${String(i).padStart(3, "0")}.mp4`);
    sliceParts.push(slicePath);

    slots.push({
      index: i + 1,
      start: Math.round(timelinePos * 100) / 100,
      duration: Math.round(dur * 100) / 100,
      sourceClipName: chosenClip.name,
    });
    timelinePos += dur;

    // Slice to 9:16 vertical (1080x1920)
    await runFfmpeg([
      "-y",
      "-ss",
      startOffset.toFixed(3),
      "-i",
      chosenClip.filePath,
      "-t",
      dur.toFixed(3),
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,setsar=1",
      "-r",
      "30",
      ...videoCodecArgs,
      "-pix_fmt",
      "yuv420p",
      "-an",
      slicePath,
    ]);

    const pct = 45 + Math.round(((i + 1) / shotDurations.length) * 40);
    onProgress?.(`Cutting shot ${i + 1} of ${shotDurations.length} (${chosenClip.name})…`, pct);
  }

  onProgress?.("Splicing shots and laying down inspired soundtrack…", 88);

  const concatList = path.join(workDir, "concat-shots.txt");
  await fs.writeFile(
    concatList,
    sliceParts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );

  const tempVideo = path.join(workDir, "video-concat.mp4");
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatList,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    tempVideo,
  ]);

  // Combine video with extracted inspiration audio
  await runFfmpeg([
    "-y",
    "-i",
    tempVideo,
    "-i",
    extractedAudioPath,
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

  // Cleanup temporary slices
  await Promise.all(sliceParts.map((p) => fs.unlink(p).catch(() => undefined)));
  await fs.unlink(concatList).catch(() => undefined);
  await fs.unlink(tempVideo).catch(() => undefined);

  onProgress?.("Ready", 100);

  const finalProbe = await probeMedia(outputFile);

  return {
    id,
    reelPath: outputFile,
    outputFileName: path.basename(outputFile),
    durationSeconds: finalProbe.durationSeconds,
    cutsCount: shotDurations.length,
    slots,
    inspiredTitle,
    inspiredDuration: targetDuration,
  };
}

