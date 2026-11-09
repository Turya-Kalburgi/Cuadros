import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { resolveYtDlp } from "./binaries";
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

async function runYtDlp(
  args: string[],
  dir: string,
  onProgress?: (percent: number) => void,
): Promise<DownloadResult> {
  const ytDlp = await resolveYtDlp();
  if (!ytDlp) {
    throw new Error("yt-dlp is not installed. Run `brew install yt-dlp` and restart the server.");
  }
  return new Promise<DownloadResult>((resolve, reject) => {
    const child = execFile(
      ytDlp,
      args,
      { maxBuffer: MAX_OUTPUT_BUFFER, env: { ...process.env, PYTHONUNBUFFERED: "1" } },
      (err, stdout, stderr) => {
      if (err) {
        const lines = (stderr || err.message).trim().split("\n").filter(Boolean);
        const detail = lines.slice(-2).join(" — ") || "yt-dlp failed.";
        reject(new Error(`Download failed: ${detail}`));
        return;
      }
      const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      const file = lines.filter((l) => path.isAbsolute(l) && l.startsWith(dir)).at(-1);
      if (!file) {
        reject(new Error("Download failed: no output file was produced."));
        return;
      }
      // First non-bracket line is the title; bracketed lines are progress/log output.
      const title = lines.find((l) => l !== file && !l.startsWith("[")) ?? null;
      resolve({ filePath: file, title });
    });

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

export async function downloadFromUrl(
  rawUrl: string,
  projectId: string,
  onProgress?: (percent: number) => void,
): Promise<DownloadResult> {
  return downloadVideoToDir(rawUrl, projectDir(projectId), onProgress);
}

export async function downloadVideoToDir(
  rawUrl: string,
  dir: string,
  onProgress?: (percent: number) => void,
  outBase = "source",
): Promise<DownloadResult> {
  const url = normalizeVideoUrl(rawUrl);
  if (!url) throw new Error("Invalid video URL.");
  await fs.mkdir(dir, { recursive: true });
  const args = [
    "--no-playlist",
    "--no-simulate",
    "--newline",
    "--progress",
    "--merge-output-format",
    "mp4",
    "-f",
    "bv*[height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
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
    await cleanupPartialFiles(dir, `${outBase}.`);
    throw err;
  }
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
