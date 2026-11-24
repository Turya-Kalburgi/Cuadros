import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { resolveFfmpeg, resolveFfprobe } from "./binaries";
import { thumbsDir } from "./paths";
import type {
  ClipRange,
  CropPosition,
  ExportFormat,
  JobMusic,
  ReelLook,
  VideoSegment,
} from "./types";

const execFileAsync = promisify(execFile);

export type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
};

type FfprobeFormat = {
  duration?: string;
};

function parseFps(rate?: string): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return null;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : null;
}

export async function probeMedia(file: string): Promise<ProbeResult> {
  const ffprobe = await resolveFfprobe();
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const data = JSON.parse(stdout) as {
    streams?: FfprobeStream[];
    format?: FfprobeFormat;
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("No video stream found in the uploaded file.");

  const duration = Number(video.duration ?? data.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine video duration.");
  }

  return {
    durationSeconds: Math.round(duration * 1000) / 1000,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: parseFps(video.avg_frame_rate) ?? parseFps(video.r_frame_rate),
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

export async function probeAudioDuration(file: string): Promise<number> {
  const ffprobe = await resolveFfprobe();
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);
  const data = JSON.parse(stdout) as { format?: { duration?: string } };
  const duration = Number(data.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine audio duration.");
  }
  return Math.round(duration * 1000) / 1000;
}

export async function generateThumbnails(
  sourceFile: string,
  projectId: string,
  durationSeconds: number,
  count = 12,
): Promise<number> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found.");
  const dir = thumbsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const interval = durationSeconds / count;
  for (let i = 0; i < count; i++) {
    const t = Math.min(Math.max(i * interval + interval / 2, 0.1), Math.max(durationSeconds - 0.1, 0.1));
    const out = path.join(dir, `thumb-${String(i).padStart(3, "0")}.jpg`);
    await execFileAsync(ffmpeg, [
      "-y",
      "-ss",
      t.toFixed(3),
      "-i",
      sourceFile,
      "-frames:v",
      "1",
      "-vf",
      "scale=320:-2",
      "-q:v",
      "4",
      out,
    ]);
  }
  return count;
}

export async function generateClipThumbnail(
  sourceFile: string,
  outFile: string,
  atSeconds?: number,
): Promise<void> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found.");
  const t = atSeconds !== undefined ? Math.max(0, atSeconds).toFixed(3) : undefined;
  const args = ["-y"];
  if (t !== undefined) args.push("-ss", t);
  args.push(
    "-i",
    sourceFile,
    "-frames:v",
    "1",
    "-vf",
    "scale=480:-2",
    "-q:v",
    "5",
    outFile,
  );
  await execFileAsync(ffmpeg, args);
}

export type RenderOptions = {
  sourceFile: string;
  ranges: ClipRange[];
  crop: CropPosition;
  format: ExportFormat;
  outputFile: string;
  workDir: string;
  videoHasAudio: boolean;
  height?: number;
  look?: ReelLook;
  mute?: boolean;
  music?: JobMusic & { file: string };
  textOverlays?: Array<{ file: string; start: number; end: number }>;
  punchIndices?: number[];
  fadeOut?: boolean;
  onProgress?: (fraction: number) => void;
};

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function gradeFilter(look: ReelLook | undefined): string {
  switch (look) {
    case "warm":
      return ",eq=brightness=0.018:gamma=1.06:contrast=1.0:saturation=1.06,colorbalance=rs=0.045:gs=0.008:bs=-0.035";
    case "clean":
      return ",eq=saturation=0.96:contrast=1.08:brightness=0.012,unsharp=5:5:0.35";
    case "cinematic":
      return ",eq=saturation=0.88:contrast=1.13:brightness=-0.008,colorbalance=rs=0.04:bs=-0.055,vignette=PI/5";
    default:
      return "";
  }
}

function buildFilter(format: ExportFormat, crop: CropPosition, height = 1080, look?: ReelLook): string {
  const h = even(height);
  const cropX = crop === "left" ? "0" : crop === "right" ? "iw-ow" : "(iw-ow)/2";
  const vw = even(Math.round((h * 9) / 16));
  const hw = even(Math.round((h * 16) / 9));
  const grade = gradeFilter(look);
  const trimCaptions = (width: number) =>
    `,crop=iw:trunc(ih*0.9/2)*2:0:0,scale=${width}:${h},setsar=1`;
  switch (format) {
    case "horizontal":
      return `scale=w=${hw}:h=${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${hw}:${h}:${cropX}:(ih-${h})/2,setsar=1${trimCaptions(hw)}${grade}`;
    case "fit":
      return `scale=w=${vw}:h=${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${vw}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1${trimCaptions(vw)}${grade}`;
    case "vertical":
    default:
      return `scale=w=${vw}:h=${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${vw}:${h}:${cropX}:(ih-${h})/2,setsar=1${trimCaptions(vw)}${grade}`;
  }
}

function outputSize(format: ExportFormat, height = 1080): { width: number; height: number } {
  const h = even(height);
  return format === "horizontal"
    ? { width: even((h * 16) / 9), height: h }
    : { width: even((h * 9) / 16), height: h };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    resolveFfmpeg().then((ffmpeg) => {
      if (!ffmpeg) {
        reject(new Error("ffmpeg not found."));
        return;
      }
      const child = execFile(ffmpeg, args, { maxBuffer: 16 * 1024 * 1024 }, (err) => {
        if (err) reject(new Error(`ffmpeg failed: ${err.message}`));
        else resolve();
      });
      void child;
    }, reject);
  });
}

export async function renderReel(opts: RenderOptions): Promise<void> {
  const { sourceFile, ranges, crop, format, outputFile, workDir, videoHasAudio, height, mute } = opts;
  const music = mute ? undefined : opts.music;
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.dirname(outputFile), { recursive: true });

  const filterTail = buildFilter(format, crop, height, opts.look);
  const overlays = (opts.textOverlays ?? []).filter((overlay) => overlay.end > overlay.start);
  const punches = new Set(opts.punchIndices ?? []);
  const size = outputSize(format, height);
  const steps = ranges.length + (music ? 2 : 1) + (overlays.length > 0 ? 1 : 0);

  const parts: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    const dur = Math.max(0.1, end - start);
    let partFilter = filterTail;
    if (punches.has(i)) {
      partFilter += `,zoompan=z='if(lt(on,6),1+0.01*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${size.width}x${size.height}:fps=30,setsar=1`;
    }
    if (opts.fadeOut && i === ranges.length - 1) {
      partFilter += `,fade=t=out:st=${(dur - 0.35).toFixed(3)}:d=0.35`;
    }
    const part = path.join(workDir, `part-${String(i).padStart(3, "0")}.mp4`);
    parts.push(part);
    await runFfmpeg([
      "-y",
      "-ss",
      start.toFixed(3),
      "-i",
      sourceFile,
      "-t",
      dur.toFixed(3),
      "-vf",
      partFilter,
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      ...(mute
        ? ["-an"]
        : ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"]),
      part,
    ]);
    opts.onProgress?.((i + 1) / steps);
  }

  const listFile = path.join(workDir, "concat.txt");
  await fs.writeFile(
    listFile,
    parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  let stageFile = music || overlays.length > 0 ? path.join(workDir, "concat.mp4") : outputFile;
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
    "-movflags",
    "+faststart",
    stageFile,
  ]);
  opts.onProgress?.((ranges.length + 1) / steps);

  if (overlays.length > 0) {
    const textFile = path.join(workDir, "text-pass.mp4");
    const textArgs = ["-y", "-i", stageFile];
    for (const overlay of overlays) {
      textArgs.push("-i", path.join(workDir, overlay.file));
    }
    const chains: string[] = [];
    let last = "0:v";
    overlays.forEach((overlay, i) => {
      const label = `tv${i}`;
      chains.push(
        `[${last}][${i + 1}:v]overlay=0:0:enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${label}]`,
      );
      last = label;
    });
    textArgs.push(
      "-filter_complex",
      chains.join(";"),
      "-map",
      `[${last}]`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-an",
      textFile,
    );
    await runFfmpeg(textArgs);
    await fs.unlink(stageFile).catch(() => undefined);
    stageFile = textFile;
    opts.onProgress?.((ranges.length + 2) / steps);
  }

  if (music) {
    const volume = Math.max(0, Math.min(1, music.volume));
    const replace = music.mode === "replace" || !videoHasAudio;

    // Slice the chosen lyric segment first so the loop repeats just that part.
    let musicFile = music.file;
    if (music.trim && music.trim.end - music.trim.start >= 0.5) {
      const seg = path.join(workDir, "music-seg.m4a");
      await runFfmpeg([
        "-y",
        "-ss",
        music.trim.start.toFixed(3),
        "-t",
        (music.trim.end - music.trim.start).toFixed(3),
        "-i",
        music.file,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        seg,
      ]);
      musicFile = seg;
    }

    const audioArgs = replace
      ? ["[1:a]volume=" + volume.toFixed(3) + "[a]"]
      : [
          "[0:a]volume=1.000[a0]",
          "[1:a]volume=" + volume.toFixed(3) + "[a1]",
          "[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]",
        ];
    await runFfmpeg([
      "-y",
      "-i",
      stageFile,
      "-stream_loop",
      "-1",
      "-i",
      musicFile,
      "-filter_complex",
      audioArgs.join(";"),
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      ...(replace ? ["-shortest"] : []),
      "-movflags",
      "+faststart",
      outputFile,
    ]);
    await fs.unlink(stageFile).catch(() => undefined);
    if (musicFile !== music.file) await fs.unlink(musicFile).catch(() => undefined);
  } else if (stageFile !== outputFile) {
    await fs.copyFile(stageFile, outputFile);
    await fs.unlink(stageFile).catch(() => undefined);
  }
  opts.onProgress?.(1);

  await Promise.all(
    parts.map((p) => fs.unlink(p).catch(() => undefined)),
  );
  await fs.unlink(listFile).catch(() => undefined);
}

export async function generateStoryboard(
  videoFile: string,
  outFile: string,
  durationSeconds: number,
): Promise<void> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return;
  const rate = Math.max(0.05, 6 / Math.max(1, durationSeconds));
  try {
    await execFileAsync(
      ffmpeg,
      [
        "-y",
        "-i",
        videoFile,
        "-vf",
        `fps=${rate.toFixed(3)},scale=180:-2,tile=3x2`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        outFile,
      ],
      { timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    /* storyboard is optional */
  }
}

export type StitchedInputPart = {
  filePath: string;
  name: string;
  sourceType: "file" | "link";
  sourceUrl?: string;
};

export async function stitchMediaParts(
  inputs: StitchedInputPart[],
  outputFile: string,
  workDir: string,
  onProgress?: (detail: string, pct: number) => void,
): Promise<{ durationSeconds: number; segments: VideoSegment[] }> {
  if (inputs.length === 0) {
    throw new Error("No input parts to stitch.");
  }

  const normalizedParts: string[] = [];
  const probedDurations: number[] = [];
  const isMac = process.platform === "darwin";

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const pct = Math.round(((i) / inputs.length) * 75);
    onProgress?.(`Processing clip ${i + 1} of ${inputs.length}: ${input.name}…`, pct);
    const probe = await probeMedia(input.filePath);
    probedDurations.push(probe.durationSeconds);

    const normPart = path.join(workDir, `norm-${String(i).padStart(3, "0")}.mp4`);
    normalizedParts.push(normPart);

    const videoCodecArgs = isMac
      ? ["-c:v", "h264_videotoolbox", "-b:v", "7000k"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "22"];

    if (probe.hasAudio) {
      await runFfmpeg([
        "-y",
        "-i",
        input.filePath,
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
        "-r",
        "30",
        ...videoCodecArgs,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        normPart,
      ]);
    } else {
      await runFfmpeg([
        "-y",
        "-i",
        input.filePath,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
        "-r",
        "30",
        ...videoCodecArgs,
        "-pix_fmt",
        "yuv420p",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-shortest",
        normPart,
      ]);
    }
  }

  onProgress?.("Stitching normalized clips together…", 80);
  const listFile = path.join(workDir, "stitch-concat.txt");
  await fs.writeFile(
    listFile,
    normalizedParts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );

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
    "-movflags",
    "+faststart",
    outputFile,
  ]);

  const finalProbe = await probeMedia(outputFile);

  let currentOffset = 0;
  const segments: VideoSegment[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const dur = probedDurations[i];
    segments.push({
      name: inputs[i].name,
      sourceType: inputs[i].sourceType,
      sourceUrl: inputs[i].sourceUrl,
      start: Math.round(currentOffset * 1000) / 1000,
      end: Math.round((currentOffset + dur) * 1000) / 1000,
      durationSeconds: Math.round(dur * 1000) / 1000,
    });
    currentOffset += dur;
  }

  // Cleanup intermediate normalized files
  await Promise.all(normalizedParts.map((p) => fs.unlink(p).catch(() => undefined)));
  await fs.unlink(listFile).catch(() => undefined);

  onProgress?.("Ready", 100);
  return {
    durationSeconds: finalProbe.durationSeconds,
    segments,
  };
}
