import { execFile } from "child_process";
import { promisify } from "util";
import { resolveFfmpeg } from "./binaries";
import { countEventsIn } from "./activity";

const execFileAsync = promisify(execFile);

/**
 * Picks the strongest moment inside a clip for a shot of `want` seconds:
 * scores evenly-spaced candidate windows by motion activity, penalizing
 * overlap with windows already used from this clip (so repeated clips show
 * DIFFERENT moments, not the same frame range twice).
 * Clips shorter than the shot return the whole clip (render slows it down).
 */
export function pickBestWindow(opts: {
  clipLength: number;
  want: number;
  events: number[];
  used: Array<{ start: number; end: number }>;
}): { start: number; end: number; stretch: number } {
  const { clipLength, want, events, used } = opts;

  if (clipLength <= want) {
    // Short clip: use it whole; the renderer stretches it to fill the shot.
    return { start: 0, end: Math.max(0.2, clipLength), stretch: want / Math.max(0.2, clipLength) };
  }

  const maxStart = Math.max(0, clipLength - want);
  const windowLen = want;

  const overlapFraction = (start: number): number => {
    let overlap = 0;
    for (const u of used) {
      const lo = Math.max(start, u.start);
      const hi = Math.min(start + windowLen, u.end);
      if (hi > lo) overlap += hi - lo;
    }
    return Math.min(1, overlap / windowLen);
  };

  const candidateCount = Math.min(12, Math.max(2, Math.round(maxStart / 0.6) + 1));
  let bestStart = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < candidateCount; i++) {
    const start = candidateCount === 1 ? 0 : (i / (candidateCount - 1)) * maxStart;
    const activity = countEventsIn(events, start, windowLen);
    const overlap = overlapFraction(start);
    const score = activity * (1 - overlap) - overlap;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  return {
    start: Math.round(bestStart * 1000) / 1000,
    end: Math.round((bestStart + want) * 1000) / 1000,
    stretch: 1,
  };
}

/**
 * Extracts the average RGB color of a single frame at the given timestamp.
 * Used for lightweight "vibe matching" between reference shots and library clips.
 */
export async function extractMeanColor(
  videoPath: string,
  atSeconds: number,
): Promise<{ r: number; g: number; b: number } | null> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return null;
  const t = Math.max(0, atSeconds).toFixed(3);
  try {
    const { stdout } = await execFileAsync(ffmpeg, [
      "-ss",
      t,
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ], { encoding: "buffer", maxBuffer: 1024 * 64 });
    if (stdout.length >= 3) {
      return { r: stdout[0], g: stdout[1], b: stdout[2] };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function colorDistance(
  a: { r: number; g: number; b: number } | null | undefined,
  b: { r: number; g: number; b: number } | null | undefined,
): number {
  if (!a || !b) return 150; // neutral penalty when unknown
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  // Max possible distance ≈ 441; normalize to 0..1
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441;
}

export function beatsForCount(count: number): Array<"hook" | "setup" | "build" | "payoff" | "cta"> {
  // Build a natural narrative arc scaled to the number of shots.
  const arc: Array<"hook" | "setup" | "build" | "payoff" | "cta"> =
    count <= 3
      ? ["hook", "payoff", "cta"]
      : count === 4
        ? ["hook", "setup", "payoff", "cta"]
        : count <= 7
          ? ["hook", "setup", "build", "build", "payoff", "cta"]
          : ["hook", "hook", "setup", "build", "build", "build", "payoff", "payoff", "cta"];

  const out: Array<"hook" | "setup" | "build" | "payoff" | "cta"> = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) out.push("hook");
    else if (i === count - 1) out.push("cta");
    else out.push(arc[Math.min(i, arc.length - 2)]);
  }
  return out;
}
