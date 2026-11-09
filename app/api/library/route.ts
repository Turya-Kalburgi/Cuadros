import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import {
  MAX_LIBRARY_CLIP_BYTES,
  addLibraryClip,
  clipFileNameFor,
  deleteLibraryClip,
  listLibraryClips,
  newLibraryId,
  sanitizeFileName,
} from "@/lib/library";
import { ensureLibraryDirs, libraryClipDir } from "@/lib/paths";

export async function GET() {
  const clips = await listLibraryClips();
  return NextResponse.json({ clips });
}

export async function POST(request: NextRequest) {
  const nameRaw = request.headers.get("x-file-name");
  if (!nameRaw) {
    return NextResponse.json({ error: "Missing x-file-name header." }, { status: 400 });
  }
  const originalName = sanitizeFileName(decodeURIComponent(nameRaw));
  if (!/\.(mp4|mov|m4v|webm|mkv)$/i.test(originalName)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use MP4, MOV, M4V, WEBM, or MKV." },
      { status: 400 },
    );
  }

  const id = newLibraryId();
  const fileName = clipFileNameFor(id, originalName);
  await ensureLibraryDirs();
  const dir = libraryClipDir(id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);

  if (!request.body) {
    return NextResponse.json({ error: "Empty upload body." }, { status: 400 });
  }

  try {
    const nodeStream = Readable.fromWeb(request.body as import("stream/web").ReadableStream);
    const fileStream = createWriteStream(filePath);
    let received = 0;
    nodeStream.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_LIBRARY_CLIP_BYTES) {
        nodeStream.destroy(new Error("File exceeds the 2 GB library clip limit."));
      }
    });
    await pipeline(nodeStream, fileStream);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    const msg = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const tagsHeader = request.headers.get("x-clip-tags") ?? "";
  const tags = tagsHeader
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

  try {
    const clip = await addLibraryClip({ id, filePath, originalName, tags });
    return NextResponse.json({ clip }, { status: 201 });
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    const msg = err instanceof Error ? err.message : "Could not process clip.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const ok = await deleteLibraryClip(id);
  if (!ok) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
