import { promises as fs } from "fs";
import os from "os";
import path from "path";

const CANDIDATE_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  path.join(os.homedir(), ".local/bin"),
];

let ffmpegCache: string | null | undefined;
let ffprobeCache: string | undefined;
let ytDlpCache: string | null | undefined;

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFfmpeg(): Promise<string | null> {
  if (ffmpegCache !== undefined) return ffmpegCache;
  if (process.env.FFMPEG_PATH && (await isExecutable(process.env.FFMPEG_PATH))) {
    ffmpegCache = process.env.FFMPEG_PATH;
    return ffmpegCache;
  }
  for (const dir of CANDIDATE_DIRS) {
    const candidate = path.join(dir, "ffmpeg");
    if (await isExecutable(candidate)) {
      ffmpegCache = candidate;
      return ffmpegCache;
    }
  }
  ffmpegCache = null;
  return ffmpegCache;
}

export async function resolveFfprobe(): Promise<string> {
  if (ffprobeCache !== undefined) return ffprobeCache;
  if (process.env.FFPROBE_PATH && (await isExecutable(process.env.FFPROBE_PATH))) {
    ffprobeCache = process.env.FFPROBE_PATH;
    return ffprobeCache;
  }
  const ffmpeg = await resolveFfmpeg();
  if (ffmpeg) {
    const sibling = path.join(path.dirname(ffmpeg), "ffprobe");
    if (await isExecutable(sibling)) {
      ffprobeCache = sibling;
      return ffprobeCache;
    }
  }
  for (const dir of CANDIDATE_DIRS) {
    const candidate = path.join(dir, "ffprobe");
    if (await isExecutable(candidate)) {
      ffprobeCache = candidate;
      return ffprobeCache;
    }
  }
  throw new Error(
    "ffprobe not found. Install FFmpeg (e.g. `brew install ffmpeg`) or set FFMPEG_PATH/FFPROBE_PATH.",
  );
}

export async function resolveYtDlp(): Promise<string | null> {
  if (ytDlpCache !== undefined) return ytDlpCache;
  if (process.env.YTDLP_PATH && (await isExecutable(process.env.YTDLP_PATH))) {
    ytDlpCache = process.env.YTDLP_PATH;
    return ytDlpCache;
  }
  for (const dir of CANDIDATE_DIRS) {
    const candidate = path.join(dir, "yt-dlp");
    if (await isExecutable(candidate)) {
      ytDlpCache = candidate;
      return ytDlpCache;
    }
  }
  ytDlpCache = null;
  return ytDlpCache;
}

export async function mediaToolsAvailable(): Promise<boolean> {
  return (await resolveFfmpeg()) !== null;
}

export async function linkImportAvailable(): Promise<boolean> {
  return (await resolveYtDlp()) !== null;
}
