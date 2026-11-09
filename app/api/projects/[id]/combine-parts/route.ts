import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { loadProject, saveProject } from "@/lib/store";
import { partsDir, projectDir, sourcePath } from "@/lib/paths";
import { probeMedia, generateThumbnails, stitchMediaParts, type StitchedInputPart } from "@/lib/media";
import { downloadFromUrl, normalizeVideoUrl } from "@/lib/ingest";
import { resolveFfmpeg, resolveYtDlp } from "@/lib/binaries";
import type { IngestState, ProjectMeta, VideoSegment } from "@/lib/types";

const THUMB_COUNT = 12;

type PartItem = {
  index: number;
  type: "file" | "link";
  name: string;
  fileName?: string;
  url?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return NextResponse.json({ error: "FFmpeg is not installed." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    parts?: PartItem[];
  } | null;

  if (!body || !Array.isArray(body.parts) || body.parts.length === 0) {
    return NextResponse.json({ error: "At least one part is required." }, { status: 400 });
  }

  const parts = [...body.parts].sort((a, b) => a.index - b.index);

  let ingestQueue = Promise.resolve();
  const setIngest = (next: IngestState) => {
    ingestQueue = ingestQueue.then(async () => {
      const fresh = await loadProject(id);
      if (!fresh) return;
      fresh.ingest = next;
      await saveProject(fresh);
    }).catch((err) => {
      console.error("setIngest write error:", err);
    });
    return ingestQueue;
  };

  // Run the combine job in the background; frontend polls GET /api/projects/:id
  void (async () => {
    try {
      const dir = partsDir(id);
      const stitchedInputs: StitchedInputPart[] = [];

      // Download any link parts
      for (let i = 0; i < parts.length; i++) {
        const item = parts[i];
        if (item.type === "link") {
          const normUrl = normalizeVideoUrl(item.url ?? "");
          if (!normUrl) throw new Error(`Invalid link URL: ${item.url}`);
          if (!(await resolveYtDlp())) throw new Error("yt-dlp is not installed for link download.");

          await setIngest({
            status: "downloading",
            progress: Math.round(((i) / parts.length) * 50),
            detail: `Downloading ${item.name || "link video"} (${i + 1}/${parts.length})…`,
          });

          const { filePath, title } = await downloadFromUrl(normUrl, id, (pct) => {
            const overallPct = Math.round(((i + pct / 100) / parts.length) * 50);
            void setIngest({
              status: "downloading",
              progress: overallPct,
              detail: `Downloading ${title || item.name || "link"} (${pct}%)…`,
            });
          });

          // Move the downloaded file into parts folder with standard naming
          const ext = path.extname(filePath).slice(1) || "mp4";
          const destPart = path.join(dir, `part-${String(item.index).padStart(3, "0")}.${ext}`);
          await fs.rename(filePath, destPart);

          stitchedInputs.push({
            filePath: destPart,
            name: title || item.name || `Link ${i + 1}`,
            sourceType: "link",
            sourceUrl: normUrl,
          });
        } else {
          // Local uploaded file
          const ext = item.fileName ? path.extname(item.fileName).slice(1) : "mp4";
          const partPath = path.join(dir, item.fileName || `part-${String(item.index).padStart(3, "0")}.${ext}`);
          try {
            await fs.access(partPath);
          } catch {
            throw new Error(`Uploaded file part missing: ${item.name}`);
          }
          stitchedInputs.push({
            filePath: partPath,
            name: item.name || `Clip ${i + 1}`,
            sourceType: "file",
          });
        }
      }

      await setIngest({
        status: "processing",
        progress: 10,
        detail: `Processing ${stitchedInputs.length} video clips with hardware acceleration…`,
      });

      const masterOutputFile = path.join(projectDir(id), "source.mp4");
      const { durationSeconds, segments } = await stitchMediaParts(
        stitchedInputs,
        masterOutputFile,
        dir,
        (detail, pct) => {
          const scaled = 10 + Math.round((pct / 100) * 75);
          void setIngest({
            status: "processing",
            progress: scaled,
            detail,
          });
        },
      );

      await ingestQueue;

      await setIngest({
        status: "processing",
        progress: 90,
        detail: "Generating timeline preview contact sheet…",
      });

      const probe = await probeMedia(masterOutputFile);
      const thumbCount = await generateThumbnails(masterOutputFile, id, durationSeconds, THUMB_COUNT);

      await ingestQueue;

      const fresh = await loadProject(id);
      if (!fresh) return;

      fresh.durationSeconds = durationSeconds;
      fresh.width = probe.width;
      fresh.height = probe.height;
      fresh.fps = probe.fps;
      fresh.hasAudio = probe.hasAudio;
      fresh.videoCodec = probe.videoCodec;
      fresh.audioCodec = probe.audioCodec;
      fresh.thumbCount = thumbCount;
      fresh.thumbInterval = durationSeconds / thumbCount;
      fresh.segments = segments;
      fresh.ingest = { status: "ready" };
      await saveProject(fresh);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Combining clips failed.";
      await setIngest({
        status: "error",
        error: message,
        detail: message,
      });
      await ingestQueue;
    }
  })();

  return NextResponse.json({ ok: true });
}

