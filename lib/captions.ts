import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { resolveFfmpeg } from "./binaries";
import { PROJECT_ROOT } from "./paths";
import type { EditPlan } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Caption burning with graceful fallbacks:
 *  1. libass (`ass` filter) when the ffmpeg build has it — fastest.
 *  2. Pillow-rendered transparent PNGs + ffmpeg `overlay` — core filters only.
 *  3. Otherwise captions are skipped from the pixels but an SRT sidecar is
 *     always written so the words are never lost.
 */

export type CaptionItem = {
  file: string;
  text: string;
  start: number;
  end: number;
};

let assFilterCache: boolean | undefined;
export async function supportsAssFilter(): Promise<boolean> {
  if (assFilterCache !== undefined) return assFilterCache;
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    assFilterCache = false;
    return false;
  }
  try {
    const { stdout } = await execFileAsync(ffmpeg, ["-filters"], { maxBuffer: 4 * 1024 * 1024 });
    assFilterCache = stdout
      .split("\n")
      .some((line) => line.trim().split(/\s+/)[1] === "ass");
  } catch {
    assFilterCache = false;
  }
  return assFilterCache;
}

let pillowCache: boolean | undefined;
export async function supportsPillow(): Promise<boolean> {
  if (pillowCache !== undefined) return pillowCache;
  try {
    await execFileAsync("python3", ["-c", "import PIL"], { timeout: 8000 });
    pillowCache = true;
  } catch {
    pillowCache = false;
  }
  return pillowCache;
}

export function captionItemsForPlan(plan: EditPlan): CaptionItem[] {
  const items: CaptionItem[] = [];
  for (const shot of plan.shots) {
    const text = shot.captionText.replace(/[{}\\]/g, "").trim();
    if (!text) continue;
    const start = shot.startAt + 0.15;
    const end = shot.startAt + shot.durationSeconds - 0.1;
    if (end - start < 0.3) continue;
    items.push({
      file: `cap-${String(items.length).padStart(3, "0")}.png`,
      text,
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
    });
  }
  return items;
}

function fmtSrtTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSrt(plan: EditPlan): string {
  const items = captionItemsForPlan(plan);
  const blocks = items.map((item, i) =>
    [
      String(i + 1),
      `${fmtSrtTime(item.start)} --> ${fmtSrtTime(item.end)}`,
      item.text.toUpperCase(),
      "",
    ].join("\n"),
  );
  return `\ufeff${blocks.join("\n")}`;
}

/** Renders one transparent 1080x1920 PNG per caption using python3 + Pillow. */
export async function renderCaptionPngs(plan: EditPlan, workDir: string): Promise<CaptionItem[]> {
  const items = captionItemsForPlan(plan);
  if (items.length === 0) return [];
  const fontPx = plan.captionEnergy === "hype" ? 80 : plan.captionEnergy === "chill" ? 56 : 68;
  const spec = {
    width: 1080,
    height: 1920,
    position: plan.captionPosition,
    fontPx,
    items: items.map((i) => ({ file: i.file, text: i.text })),
  };
  const specPath = path.join(workDir, "captions-spec.json");
  await fs.writeFile(specPath, JSON.stringify(spec), "utf8");
  const script = path.join(PROJECT_ROOT, "lib", "render_captions.py");
  await execFileAsync("python3", [script, specPath], { timeout: 30000 });
  return items;
}

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

/** Burns caption PNGs onto the video using only core `overlay` + `enable`. */
export async function burnPngCaptions(opts: {
  inputVideo: string;
  items: CaptionItem[];
  workDir: string;
  outputFile: string;
}): Promise<void> {
  const { inputVideo, items, workDir, outputFile } = opts;
  const args = ["-y", "-i", inputVideo];
  for (const item of items) {
    args.push("-i", item.file);
  }
  const chains: string[] = [];
  let last = "0:v";
  for (let i = 0; i < items.length; i++) {
    const label = `cv${i}`;
    const item = items[i];
    chains.push(
      `[${last}][${i + 1}:v]overlay=0:0:enable='between(t,${item.start},${item.end})'[${label}]`,
    );
    last = label;
  }
  args.push(
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
    outputFile,
  );
  await runFfmpeg(args, { cwd: workDir });
}
