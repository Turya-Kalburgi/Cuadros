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
let sayCache: string | null | undefined;

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

export function ytDlpCommonArgs(): string[] {
  const args: string[] = [];
  const extractor: string[] = [];
  const playerClient = process.env.YTDLP_PLAYER_CLIENT?.trim();
  const visitorData = process.env.YTDLP_VISITOR_DATA?.trim();
  if (playerClient) extractor.push(`player_client=${playerClient}`);
  if (visitorData) extractor.push(`visitor_data=${visitorData}`);
  if (extractor.length > 0) {
    args.push("--extractor-args", `youtube:${extractor.join(";")}`);
  }
  const sleep = Number(process.env.YTDLP_SLEEP_REQUESTS ?? 0);
  if (Number.isFinite(sleep) && sleep > 0) {
    args.push("--sleep-requests", String(sleep));
  }
  const rawExtra = process.env.YTDLP_EXTRA_ARGS?.trim();
  if (rawExtra) {
    try {
      const parsed = JSON.parse(rawExtra) as unknown;
      if (Array.isArray(parsed)) args.push(...parsed.map(String));
      else args.push(...rawExtra.split(/\s+/).filter(Boolean));
    } catch {
      args.push(...rawExtra.split(/\s+/).filter(Boolean));
    }
  }
  return args;
}

export function ytDlpCookieVariants(): string[][] {
  const variants: string[][] = [];
  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
  if (cookiesFile) variants.push(["--cookies", cookiesFile]);
  const rawBrowsers =
    process.env.YTDLP_COOKIES_FROM_BROWSERS ??
    process.env.YTDLP_COOKIES_FROM_BROWSER ??
    "chrome,safari";
  for (const browser of rawBrowsers.split(",").map((item) => item.trim()).filter(Boolean)) {
    variants.push(["--cookies-from-browser", browser]);
  }
  variants.push([]);
  return variants;
}

export async function resolveSay(): Promise<string | null> {
  if (sayCache !== undefined) return sayCache;
  if (process.env.SAY_BINARY && (await isExecutable(process.env.SAY_BINARY))) {
    sayCache = process.env.SAY_BINARY;
    return sayCache;
  }
  for (const dir of CANDIDATE_DIRS) {
    const candidate = path.join(dir, "say");
    if (await isExecutable(candidate)) {
      sayCache = candidate;
      return sayCache;
    }
  }
  sayCache = null;
  return sayCache;
}

export async function mediaToolsAvailable(): Promise<boolean> {
  return (await resolveFfmpeg()) !== null;
}

export async function linkImportAvailable(): Promise<boolean> {
  return (await resolveYtDlp()) !== null;
}
