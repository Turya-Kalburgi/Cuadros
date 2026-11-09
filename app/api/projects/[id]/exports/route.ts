import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { loadProject, saveProject } from "@/lib/store";
import { exportsDir, projectDir } from "@/lib/paths";
import { renderReel } from "@/lib/media";
import { resolveFfmpeg } from "@/lib/binaries";
import {
  EXPORT_FORMATS,
  type ClipRange,
  type CropPosition,
  type ExportFormat,
  type ExportJob,
  type JobMusic,
  type MusicMode,
} from "@/lib/types";

const MIN_CLIP_SECONDS = 0.3;
const MAX_TOTAL_SECONDS = 180;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (!(await resolveFfmpeg())) {
    return NextResponse.json(
      { error: "FFmpeg is not installed. Run `brew install ffmpeg` and restart the server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    ranges?: ClipRange[];
    crop?: CropPosition;
    format?: ExportFormat;
    includeMusic?: boolean;
    musicVolume?: number;
    musicMode?: MusicMode;
    musicTrim?: { start?: unknown; end?: unknown };
  } | null;
  if (!body || !Array.isArray(body.ranges) || body.ranges.length === 0) {
    return NextResponse.json({ error: "At least one clip range is required." }, { status: 400 });
  }

  const crop: CropPosition = body.crop ?? "center";
  if (!["left", "center", "right"].includes(crop)) {
    return NextResponse.json({ error: "Invalid crop position." }, { status: 400 });
  }

  const format: ExportFormat = body.format ?? "vertical";
  if (!EXPORT_FORMATS.includes(format)) {
    return NextResponse.json({ error: "Invalid export format." }, { status: 400 });
  }

  // Snapshot the music track for this job (if imported and enabled).
  let jobMusic: JobMusic | null = null;
  const musicFile = project.music?.status === "ready" ? project.music.fileName : undefined;
  if (body.includeMusic !== false && musicFile) {
    const volume = Number(body.musicVolume);
    const mode: MusicMode = body.musicMode === "replace" ? "replace" : "mix";
    jobMusic = {
      fileName: musicFile,
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.6,
      mode,
    };

    // Optional lyric-segment trim within the track.
    if (body.musicTrim != null) {
      const start = Number(body.musicTrim.start);
      const end = Number(body.musicTrim.end);
      const maxEnd = project.music?.durationSeconds ?? end;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end - start < 1 ||
        end > maxEnd + 0.05
      ) {
        return NextResponse.json({ error: "Invalid music trim range." }, { status: 400 });
      }
      jobMusic.trim = {
        start: Math.round(start * 1000) / 1000,
        end: Math.min(Math.round(end * 1000) / 1000, maxEnd),
      };
    }
  }

  const duration = project.durationSeconds;
  const ranges: ClipRange[] = [];
  let total = 0;
  for (const r of body.ranges) {
    const start = Number(r?.start);
    const end = Number(r?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return NextResponse.json({ error: "Each range needs numeric start and end." }, { status: 400 });
    }
    if (start < 0 || end > duration + 0.001 || end <= start) {
      return NextResponse.json(
        { error: `Range ${start.toFixed(2)}s–${end.toFixed(2)}s is outside the video or empty.` },
        { status: 400 },
      );
    }
    if (end - start < MIN_CLIP_SECONDS) {
      return NextResponse.json(
        { error: `Each clip must be at least ${MIN_CLIP_SECONDS}s.` },
        { status: 400 },
      );
    }
    total += end - start;
    ranges.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
  }
  if (total > MAX_TOTAL_SECONDS) {
    return NextResponse.json(
      { error: `Total edit length ${total.toFixed(1)}s exceeds the ${MAX_TOTAL_SECONDS}s MVP limit.` },
      { status: 400 },
    );
  }

  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: ExportJob = {
    id: jobId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    ranges,
    crop,
    format,
    music: jobMusic,
    outputFile: null,
    error: null,
  };
  project.exports.unshift(job);
  await saveProject(project);

  const sourceFile = path.join(projectDir(id), `source.${guessExt(project.originalName)}`);
  const outputFile = path.join(exportsDir(id), `reel-${jobId.slice(0, 8)}.mp4`);

  // Run the render in the background; the client polls the project endpoint.
  void (async () => {
    const update = async (patch: Partial<ExportJob>) => {
      const fresh = await loadProject(id);
      if (!fresh) return;
      const target = fresh.exports.find((e) => e.id === jobId);
      if (!target) return;
      Object.assign(target, patch, { updatedAt: new Date().toISOString() });
      await saveProject(fresh);
    };
    try {
      await update({ status: "rendering" });
      await renderReel({
        sourceFile,
        ranges,
        crop,
        format,
        outputFile,
        workDir: path.join(exportsDir(id), `work-${jobId.slice(0, 8)}`),
        videoHasAudio: project.hasAudio,
        music: jobMusic
          ? { ...jobMusic, file: path.join(projectDir(id), jobMusic.fileName) }
          : undefined,
      });
      await update({ status: "done", outputFile: path.basename(outputFile) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Render failed.";
      await update({ status: "error", error: message });
    }
  })();

  return NextResponse.json({ job }, { status: 202 });
}

function guessExt(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  return ext || "mp4";
}
