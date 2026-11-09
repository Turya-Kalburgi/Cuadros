import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, promises as fs } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";
import { probeMedia, generateThumbnails } from "@/lib/media";
import { loadProject, newId, listProjects, saveProject } from "@/lib/store";
import { ensureProjectDirs, sourcePath, metaPath } from "@/lib/paths";
import type { ProjectMeta } from "@/lib/types";

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const rawName = request.headers.get("x-file-name");
  if (!rawName) {
    return NextResponse.json({ error: "Missing x-file-name header." }, { status: 400 });
  }
  const originalName = path.basename(decodeURIComponent(rawName));
  const ext = path.extname(originalName).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type ".${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}.` },
      { status: 415 },
    );
  }
  if (!request.body) {
    return NextResponse.json({ error: "Empty upload body." }, { status: 400 });
  }

  const id = newId();
  await ensureProjectDirs(id);
  const src = sourcePath(id, ext);
  const tmp = `${src}.uploading`;

  let written = 0;
  try {
    const source = Readable.fromWeb(request.body as import("stream/web").ReadableStream);
    const sink = createWriteStream(tmp);
    source.on("data", (chunk: Buffer) => {
      written += chunk.length;
      if (written > MAX_UPLOAD_BYTES) {
        source.destroy(new Error("Upload exceeds the 4 GB limit."));
      }
    });
    await pipeline(source, sink);
    await fs.rename(tmp, src);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    await fs.unlink(src).catch(() => undefined);
    await fs.rm(path.dirname(src), { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const probe = await probeMedia(src);
    const THUMB_COUNT = 12;
    const thumbCount = await generateThumbnails(src, id, probe.durationSeconds, THUMB_COUNT);
    const meta: ProjectMeta = {
      id,
      originalName,
      createdAt: new Date().toISOString(),
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      hasAudio: probe.hasAudio,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      thumbCount,
      thumbInterval: probe.durationSeconds / thumbCount,
      exports: [],
    };
    await saveProject(meta);
    return NextResponse.json({ project: meta }, { status: 201 });
  } catch (err) {
    await fs.rm(path.dirname(src), { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Failed to inspect media.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !(await loadProject(id))) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  await fs.rm(path.dirname(metaPath(id)), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
