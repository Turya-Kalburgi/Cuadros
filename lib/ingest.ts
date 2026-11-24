import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { resolveYtDlp, ytDlpCommonArgs, ytDlpCookieVariants } from "./binaries";
import { projectDir } from "./paths";

const MAX_URL_LENGTH = 2048;
const MAX_OUTPUT_BUFFER = 64 * 1024 * 1024;

export function normalizeVideoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

export type DownloadResult = {
  filePath: string;
  title: string | null;
};

function isRetryableYtDlpError(message: string): boolean {
  return /sign in to confirm|bot|429|too many requests|login_required|cookie|unable to download webpage/i.test(
    message,
  );
}

function friendlyYtDlpError(message: string): Error {
  const clean = message.replace(/^Download failed:\s*/, "");
  if (/sign in to confirm|bot/i.test(clean)) {
    return new Error(
      "YouTube blocked this download (bot check). Keep Chrome/Safari signed in and retry, or set YTDLP_COOKIES_FILE.",
    );
  }
  if (/429|too many requests/i.test(clean)) {
    return new Error(
      "YouTube rate-limited this IP. Wait a few minutes, or set YTDLP_COOKIES_FILE / YTDLP_SLEEP_REQUESTS=2.",
    );
  }
  if (/only images|requested format is not available/i.test(clean)) {
    return new Error(
      "YouTube did not expose a video format for this link (often a login/bot restriction). Sign into Chrome/Safari and retry, or upload a local video file.",
    );
  }
  return new Error(`Download failed: ${clean.split("\n").filter(Boolean).slice(-2).join(" — ")}`);
}

function runYtDlpOnce(
  ytDlp: string,
  args: string[],
  dir: string,
  onProgress?: (percent: number) => void,
): Promise<DownloadResult> {
  return new Promise<DownloadResult>((resolve, reject) => {
    const child = execFile(
      ytDlp,
      args,
      { maxBuffer: MAX_OUTPUT_BUFFER, env: { ...process.env, PYTHONUNBUFFERED: "1" } },
      (err, stdout, stderr) => {
        if (err) {
          const lines = (stderr || err.message).trim().split("\n").filter(Boolean);
          reject(new Error(lines.slice(-2).join(" — ") || "yt-dlp failed."));
          return;
        }
        const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        const file = lines.filter((l) => path.isAbsolute(l) && l.startsWith(dir)).at(-1);
        if (!file) {
          reject(new Error("no output file was produced."));
          return;
        }
        const title = lines.find((l) => l !== file && !l.startsWith("[")) ?? null;
        resolve({ filePath: file, title });
      },
    );

    let lastEmitted = -1;
    const emit = (text: string) => {
      const matches = [...text.matchAll(/(\d+(?:\.\d+)?)% of/g)];
      if (matches.length === 0) return;
      const pct = Math.max(
        0,
        Math.min(100, Math.round(parseFloat(matches[matches.length - 1][1]))),
      );
      if (pct === lastEmitted) return;
      lastEmitted = pct;
      onProgress?.(pct);
    };
    child.stderr?.on("data", (buf: Buffer) => emit(buf.toString()));
    child.stdout?.on("data", (buf: Buffer) => emit(buf.toString()));
  });
}

async function runYtDlp(
  args: string[],
  dir: string,
  onProgress?: (percent: number) => void,
): Promise<DownloadResult> {
  const ytDlp = await resolveYtDlp();
  if (!ytDlp) {
    throw new Error("yt-dlp is not installed. Run `brew install yt-dlp` and restart the server.");
  }
  const common = ytDlpCommonArgs();
  const variants = ytDlpCookieVariants();
  let lastMessage = "yt-dlp failed.";
  for (let i = 0; i < variants.length; i++) {
    const throttle = i === 0 ? [] : ["--sleep-requests", process.env.YTDLP_RETRY_SLEEP ?? "2"];
    try {
      return await runYtDlpOnce(
        ytDlp,
        [...common, ...variants[i], ...throttle, ...args],
        dir,
        onProgress,
      );
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err);
      if (!isRetryableYtDlpError(lastMessage)) throw friendlyYtDlpError(lastMessage);
    }
  }
  if (/sign in to confirm|bot|429|requested format|only images/i.test(lastMessage)) {
    for (const browser of ["chrome", "safari"]) {
      try {
        return await runYtDlpOnce(
          ytDlp,
          [
            ...common,
            "--cookies-from-browser",
            browser,
            "--extractor-args",
            "youtube:player_client=web_safari",
            "--sleep-requests",
            "2",
            ...args,
          ],
          dir,
          onProgress,
        );
      } catch (err) {
        lastMessage = err instanceof Error ? err.message : String(err);
      }
    }
  }
  throw friendlyYtDlpError(lastMessage);
}

export async function downloadFromUrl(
  rawUrl: string,
  projectId: string,
  onProgress?: (percent: number) => void,
  maxHeight = 1080,
): Promise<DownloadResult> {
  return downloadVideoToDir(rawUrl, projectDir(projectId), onProgress, "source", maxHeight);
}

export async function downloadVideoToDir(
  rawUrl: string,
  dir: string,
  onProgress?: (percent: number) => void,
  outBase = "source",
  maxHeight = 1080,
): Promise<DownloadResult> {
  const url = normalizeVideoUrl(rawUrl);
  if (!url) throw new Error("Invalid video URL.");
  const cap = Math.min(2160, Math.max(360, Math.round(maxHeight)));
  await fs.mkdir(dir, { recursive: true });
  const formats = [
    `bv*[height<=${cap}]+ba[ext=m4a]/bv*[height<=${cap}]+ba/b[height<=${cap}]/b`,
    "bestvideo+bestaudio/best",
    "",
  ];
  let lastError: unknown = null;
  for (const format of formats) {
    await cleanupPartialFiles(dir, `${outBase}.`);
    const args = [
      "--no-playlist",
      "--no-simulate",
      "--newline",
      "--progress",
      "--merge-output-format",
      "mp4",
      ...(format ? ["-f", format] : []),
      "--print",
      "title",
      "--print",
      "after_move:filepath",
      "-o",
      path.join(dir, `${outBase}.%(ext)s`),
      url,
    ];
    try {
      return await runYtDlp(args, dir, onProgress);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("Download failed.");
}

export async function downloadAudioFromUrl(
  rawUrl: string,
  projectId: string,
  onProgress?: (percent: number) => void,
): Promise<DownloadResult> {
  const url = normalizeVideoUrl(rawUrl);
  if (!url) throw new Error("Invalid music URL.");
  const dir = projectDir(projectId);
  const args = [
    "--no-playlist",
    "--no-simulate",
    "--newline",
    "--progress",
    "-x",
    "--audio-format",
    "m4a",
    "--audio-quality",
    "0",
    "-f",
    "ba/b",
    "--print",
    "title",
    "--print",
    "after_move:filepath",
    "-o",
    path.join(dir, "music.%(ext)s"),
    url,
  ];
  try {
    return await runYtDlp(args, dir, onProgress);
  } catch (err) {
    await cleanupPartialFiles(dir, "music.");
    throw err;
  }
}

async function cleanupPartialFiles(dir: string, prefix: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(prefix))
        .map((name) => fs.unlink(path.join(dir, name)).catch(() => undefined)),
    );
  } catch {
    /* best effort */
  }
}
