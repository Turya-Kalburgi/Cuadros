import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { PROJECT_ROOT } from "./paths";

const execFileAsync = promisify(execFile);

export type ReelTextStyle = "hook" | "stamp";

export type ReelTextItem = {
  file: string;
  text: string;
  style: ReelTextStyle;
  start: number;
  end: number;
};

export async function renderTextPngs(
  items: ReelTextItem[],
  workDir: string,
  width: number,
  height: number,
): Promise<void> {
  if (items.length === 0) return;
  const specPath = path.join(workDir, "reel-text-spec.json");
  await fs.writeFile(
    specPath,
    JSON.stringify({
      width,
      height,
      outDir: workDir,
      items: items.map((item) => ({ file: item.file, text: item.text, style: item.style })),
    }),
    "utf8",
  );
  try {
    await execFileAsync(
      "python3",
      [path.join(PROJECT_ROOT, "lib", "render_reel_text.py"), specPath],
      { timeout: 30000 },
    );
  } catch {
    /* text is decorative — a failed render must not break the reel */
  }
  await fs.unlink(specPath).catch(() => undefined);
}

export function buildReelTexts(opts: {
  ranges: Array<{ start: number; end: number }>;
  hook: string;
  index: number;
  sourceDuration?: number;
}): ReelTextItem[] {
  const items: ReelTextItem[] = [];
  let cursor = 0;
  for (let i = 0; i < opts.ranges.length; i++) {
    const duration = Math.max(0.2, opts.ranges[i].end - opts.ranges[i].start);
    if (i === 0) {
      items.push({
        file: `hook-${opts.index}.png`,
        text: opts.hook,
        style: "hook",
        start: 0.1,
        end: Math.min(duration - 0.1, 2.6),
      });
    } else if (i % 3 === 0) {
      const sourceAt = opts.ranges[i].start;
      const progress = opts.sourceDuration ? Math.min(1, sourceAt / opts.sourceDuration) : i / 20;
      const minutes = 6 * 60 + 30 + Math.round(progress * 16 * 60);
      const hour24 = Math.floor(minutes / 60) % 24;
      const hour = hour24 % 12 || 12;
      const mm = String(minutes % 60).padStart(2, "0");
      items.push({
        file: `stamp-${opts.index}-${i}.png`,
        text: `${hour}:${mm} ${hour24 < 12 ? "AM" : "PM"}`,
        style: "stamp",
        start: cursor + 0.15,
        end: cursor + Math.max(0.3, duration - 0.15),
      });
    }
    cursor += duration;
  }
  return items.filter((item) => item.end > item.start);
}
