import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { resolveFfmpeg } from "@/lib/binaries";
import { downloadFromUrl, normalizeVideoUrl } from "@/lib/ingest";
import { probeMedia } from "@/lib/media";
import { autoDir, autoMetaPath, readJson, writeJson } from "@/lib/paths";
import { newId } from "@/lib/store";
import type { TimelineFrame, TimelineJobMeta } from "@/lib/types";

const execFileAsync = promisify(execFile);

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = normalizeVideoUrl(String(body?.url ?? ""));
  if (!url) return NextResponse.json({ error: "Paste a valid video link." }, { status: 400 });

  const id = randomUUID();
  const sourceId = newId();
  const dir = autoDir(id);
  const framesDir = path.join(dir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const metaFile = autoMetaPath(id);
  const meta: TimelineJobMeta = {
    id,
    status: "downloading",
    progress: 2,
    detail: "Queued…",
    url,
    sourceId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJson(metaFile, meta);

  const update = async (patch: Partial<TimelineJobMeta>) => {
    const current = (await readJson<TimelineJobMeta>(metaFile)) ?? meta;
    await writeJson(metaFile, { ...current, ...patch, updatedAt: new Date().toISOString() });
  };

  void (async () => {
    try {
      const ffmpeg = await resolveFfmpeg();
      if (!ffmpeg) throw new Error("FFmpeg is not installed.");
      await update({ status: "downloading", progress: 5, detail: "Downloading source video…" });
      const { filePath } = await downloadFromUrl(url, sourceId, (pct) => {
        void update({ progress: 5 + Math.round(pct * 0.4), detail: `Downloading source video… ${pct}%` });
      });
      const probe = await probeMedia(filePath);
      const interval = Math.max(2, Math.round(probe.durationSeconds / 120));
      await update({
        status: "generating",
        progress: 50,
        detail: `Building timeline — one frame every ${interval}s…`,
        durationSeconds: probe.durationSeconds,
        interval,
      });
      await execFileAsync(
        ffmpeg,
        [
          "-y",
          "-i",
          filePath,
          "-vf",
          `fps=1/${interval},scale=240:-2`,
          "-q:v",
          "5",
          path.join(framesDir, "frame-%03d.jpg"),
        ],
        { timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
      );
      const files = (await fs.readdir(framesDir))
        .filter((name) => name.startsWith("frame-") && name.endsWith(".jpg"))
        .sort();
      const frames: TimelineFrame[] = files.map((name, index) => ({
        index: index + 1,
        time: Math.round((index + 0.5) * interval * 10) / 10,
        file: `frames/${name}`,
      }));
      await update({
        status: "ready",
        progress: 100,
        detail: `${frames.length} frames ready`,
        frames,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Timeline failed.";
      await update({ status: "error", error: message, detail: message });
    }
  })();

  return NextResponse.json({ job: meta }, { status: 201 });
}
