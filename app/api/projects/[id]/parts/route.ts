import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, promises as fs } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";
import { loadProject } from "@/lib/store";
import { partsDir } from "@/lib/paths";

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const rawName = request.headers.get("x-file-name");
  const rawIndex = request.headers.get("x-part-index");
  if (!rawName || rawIndex === null) {
    return NextResponse.json({ error: "Missing x-file-name or x-part-index header." }, { status: 400 });
  }

  const index = parseInt(rawIndex, 10);
  if (!Number.isFinite(index) || index < 0) {
    return NextResponse.json({ error: "Invalid part index." }, { status: 400 });
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

  const dir = partsDir(id);
  await fs.mkdir(dir, { recursive: true });
  const partFileName = `part-${String(index).padStart(3, "0")}.${ext}`;
  const targetPath = path.join(dir, partFileName);
  const tmpPath = `${targetPath}.uploading`;

  let written = 0;
  try {
    const source = Readable.fromWeb(request.body as import("stream/web").ReadableStream);
    const sink = createWriteStream(tmpPath);
    source.on("data", (chunk: Buffer) => {
      written += chunk.length;
      if (written > MAX_UPLOAD_BYTES) {
        source.destroy(new Error("File part exceeds 4 GB limit."));
      }
    });
    await pipeline(source, sink);
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => undefined);
    await fs.unlink(targetPath).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, index, fileName: partFileName, originalName });
}

