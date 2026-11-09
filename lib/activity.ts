import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { resolveFfmpeg } from "./binaries";
import { libraryClipDir } from "./paths";

const execFileAsync = promisify(execFile);

/**
 * Motion-activity timeline for a clip: timestamps of frames whose scene-change
 * score crosses a low threshold. Denser events = livelier moment. Used to pick
 * the BEST shot window inside each library clip instead of always its middle.
 * Cached per library clip so repeated recreations are instant.
 */

type ActivityCache = {
  version: 1;
  durationSeconds: number;
  events: number[];
};

const CACHE_VERSION = 1;

async function analyzeActivity(videoPath: string): Promise<number[]> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return [];
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        "-i",
        videoPath,
        "-vf",
        "select='gt(scene,0.015)',showinfo",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const events: number[] = [];
    const regex = /pts_time:([0-9.]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(stderr)) !== null) {
      const t = parseFloat(match[1]);
      if (Number.isFinite(t)) events.push(Math.round(t * 100) / 100);
    }
    events.sort((a, b) => a - b);
    return events;
  } catch {
    return [];
  }
}

export async function loadClipActivity(
  clipId: string,
  filePath: string,
  durationSeconds: number,
): Promise<number[]> {
  const cachePath = path.join(libraryClipDir(clipId), "activity.json");
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const cached = JSON.parse(raw) as ActivityCache;
    if (
      cached.version === CACHE_VERSION &&
      Array.isArray(cached.events) &&
      typeof cached.durationSeconds === "number" &&
      Math.abs(cached.durationSeconds - durationSeconds) < 0.5
    ) {
      return cached.events;
    }
  } catch {
    /* no cache yet */
  }

  const events = await analyzeActivity(filePath);
  const cache: ActivityCache = {
    version: CACHE_VERSION,
    durationSeconds,
    events,
  };
  await fs.writeFile(cachePath, JSON.stringify(cache), "utf8").catch(() => undefined);
  return events;
}

/** Number of activity events inside [start, start+dur]. */
export function countEventsIn(events: number[], start: number, dur: number): number {
  if (events.length === 0) return 0;
  const end = start + dur;
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid] < start) lo = mid + 1;
    else hi = mid;
  }
  let count = 0;
  for (let i = lo; i < events.length && events[i] < end; i++) count++;
  return count;
}
