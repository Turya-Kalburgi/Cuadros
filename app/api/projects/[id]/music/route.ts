import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { loadProject, saveProject } from "@/lib/store";
import { projectDir } from "@/lib/paths";
import { downloadAudioFromUrl, normalizeVideoUrl } from "@/lib/ingest";
import { probeAudioDuration } from "@/lib/media";
import { resolveYtDlp } from "@/lib/binaries";
import type { ProjectMusic } from "@/lib/types";

const PROGRESS_SAVE_STEP = 5;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (project.ingest && project.ingest.status !== "ready") {
    return NextResponse.json({ error: "The video is still being imported." }, { status: 409 });
  }
  if (project.music && (project.music.status === "downloading" || project.music.status === "processing")) {
    return NextResponse.json({ error: "A track is already downloading." }, { status: 409 });
  }
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = normalizeVideoUrl(String(body?.url ?? ""));
  if (!url) {
    return NextResponse.json({ error: "That doesn't look like a valid music URL." }, { status: 400 });
  }
  if (!(await resolveYtDlp())) {
    return NextResponse.json(
      { error: "yt-dlp is not installed. Run `brew install yt-dlp` and restart the server." },
      { status: 503 },
    );
  }

  project.music = { status: "downloading", progress: 0, sourceUrl: url };
  await saveProject(project);

  const setMusic = async (next: ProjectMusic, allowedFrom: ProjectMusic["status"][]) => {
    const fresh = await loadProject(id);
    if (!fresh?.music) return;
    if (!allowedFrom.includes(fresh.music.status)) return;
    fresh.music = { ...fresh.music, ...next };
    await saveProject(fresh);
  };

  // Download in the background; the client polls GET /api/projects/:id.
  void (async () => {
    try {
      let lastSavedPct = -PROGRESS_SAVE_STEP;
      const { filePath, title } = await downloadAudioFromUrl(url, id, (pct) => {
        if (pct - lastSavedPct < PROGRESS_SAVE_STEP && pct < 100) return;
        lastSavedPct = pct;
        void setMusic({ status: "downloading", progress: pct }, ["downloading"]);
      });

      await setMusic({ status: "processing" }, ["downloading"]);
      const durationSeconds = await probeAudioDuration(filePath);
      const fresh = await loadProject(id);
      if (!fresh?.music) return;
      fresh.music = {
        status: "ready",
        progress: 100,
        fileName: path.basename(filePath),
        title: (title?.slice(0, 200) || path.basename(filePath)) as string,
        durationSeconds,
        sourceUrl: url,
      };
      await saveProject(fresh);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Music import failed.";
      await setMusic({ status: "error", error: message }, ["downloading", "processing"]);
    }
  })();

  return NextResponse.json({ music: project.music }, { status: 202 });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (
    project.music &&
    project.music.status !== "ready" &&
    project.music.status !== "error"
  ) {
    return NextResponse.json({ error: "Music is still downloading." }, { status: 409 });
  }
  const fileName = project.music?.fileName;
  if (fileName) {
    const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "");
    if (safe === fileName) {
      await fs.unlink(path.join(projectDir(id), fileName)).catch(() => undefined);
    }
  }
  delete project.music;
  await saveProject(project);
  return NextResponse.json({ ok: true });
}
