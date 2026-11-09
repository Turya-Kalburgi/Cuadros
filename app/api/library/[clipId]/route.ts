import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { getLibraryClip, libraryClipFilePath, deleteLibraryClip, updateLibraryClipTags } from "@/lib/library";
import { libraryClipDir } from "@/lib/paths";

type Params = { params: Promise<{ clipId: string }> };

function streamFile(filePath: string, contentType: string, request: NextRequest) {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  return fs.stat(filePath).then((stat) => {
    const size = stat.size;
    const range = request.headers.get("range");
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : size - 1;
        if (!match[1] && match[2]) {
          start = Math.max(0, size - parseInt(match[2], 10));
          end = size - 1;
        }
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
          end = Math.min(end, size - 1);
          const stream = createReadStream(filePath, { start, end });
          return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              ...headers,
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Content-Length": String(end - start + 1),
            },
          });
        }
      }
    }
    const stream = createReadStream(filePath);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: { ...headers, "Content-Length": String(size) },
    });
  });
}

export async function GET(request: NextRequest, { params }: Params) {
  const { clipId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) {
    return NextResponse.json({ error: "Invalid clip id" }, { status: 400 });
  }

  const wantThumb = request.nextUrl.searchParams.get("thumb") === "1";
  if (wantThumb) {
    const thumbPath = path.join(libraryClipDir(clipId), "thumb.jpg");
    try {
      await fs.access(thumbPath);
      return streamFile(thumbPath, "image/jpeg", request);
    } catch {
      return NextResponse.json({ error: "No thumbnail." }, { status: 404 });
    }
  }

  const clip = await getLibraryClip(clipId);
  if (!clip) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  const filePath = await libraryClipFilePath(clip);
  if (!filePath) return NextResponse.json({ error: "Media missing." }, { status: 404 });

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";
  return streamFile(filePath, contentType, request);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { clipId } = await params;
  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  if (!body || !Array.isArray(body.tags)) {
    return NextResponse.json({ error: "Expected { tags: string[] }." }, { status: 400 });
  }
  const tags = body.tags.filter((t): t is string => typeof t === "string");
  const clip = await updateLibraryClipTags(clipId, tags);
  if (!clip) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  return NextResponse.json({ clip });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { clipId } = await params;
  const ok = await deleteLibraryClip(clipId);
  if (!ok) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
