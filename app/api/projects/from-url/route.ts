import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { loadProject, newId, saveProject } from "@/lib/store";
import { ensureProjectDirs } from "@/lib/paths";
import { probeMedia, generateThumbnails } from "@/lib/media";
import { downloadFromUrl, normalizeVideoUrl } from "@/lib/ingest";
import { resolveYtDlp } from "@/lib/binaries";
import type { IngestState, ProjectMeta } from "@/lib/types";

const THUMB_COUNT = 12;
const PROGRESS_SAVE_STEP = 3;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = normalizeVideoUrl(String(body?.url ?? ""));
  if (!url) {
    return NextResponse.json({ error: "That doesn't look like a valid video URL." }, { status: 400 });
  }
  if (!(await resolveYtDlp())) {
    return NextResponse.json(
      { error: "yt-dlp is not installed. Run `brew install yt-dlp` and restart the server." },
      { status: 503 },
    );
  }

  const id = newId();
  await ensureProjectDirs(id);
  const meta: ProjectMeta = {
    id,
    originalName: new URL(url).hostname,
    createdAt: new Date().toISOString(),
    durationSeconds: 0,
    width: 0,
    height: 0,
    fps: null,
    hasAudio: false,
    videoCodec: null,
    audioCodec: null,
    thumbCount: 0,
    thumbInterval: 0,
    exports: [],
    sourceUrl: url,
    ingest: { status: "downloading", progress: 0 },
  };
  await saveProject(meta);

  const setIngest = async (next: IngestState, allowedFrom: IngestState["status"][]) => {
    const fresh = await loadProject(id);
    if (!fresh?.ingest) return;
    if (!allowedFrom.includes(fresh.ingest.status)) return;
    fresh.ingest = next;
    await saveProject(fresh);
  };

  // Download + inspect in the background; the client polls GET /api/projects/:id.
  void (async () => {
    try {
      let lastSavedPct = -PROGRESS_SAVE_STEP;
      const { filePath, title } = await downloadFromUrl(url, id, (pct) => {
        if (pct - lastSavedPct < PROGRESS_SAVE_STEP && pct < 100) return;
        lastSavedPct = pct;
        void setIngest({ status: "downloading", progress: pct }, ["downloading"]);
      });

      await setIngest({ status: "processing" }, ["downloading"]);
      const probe = await probeMedia(filePath);
      const thumbCount = await generateThumbnails(filePath, id, probe.durationSeconds, THUMB_COUNT);

      const fresh = await loadProject(id);
      if (!fresh) return;
      fresh.originalName = title?.slice(0, 200) || path.basename(filePath);
      fresh.durationSeconds = probe.durationSeconds;
      fresh.width = probe.width;
      fresh.height = probe.height;
      fresh.fps = probe.fps;
      fresh.hasAudio = probe.hasAudio;
      fresh.videoCodec = probe.videoCodec;
      fresh.audioCodec = probe.audioCodec;
      fresh.thumbCount = thumbCount;
      fresh.thumbInterval = probe.durationSeconds / thumbCount;
      fresh.ingest = { status: "ready" };
      await saveProject(fresh);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed.";
      await setIngest({ status: "error", error: message }, ["downloading", "processing"]);
    }
  })();

  return NextResponse.json({ project: meta }, { status: 202 });
}
