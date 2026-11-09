import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { loadProject } from "@/lib/store";
import { projectDir } from "@/lib/paths";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project || project.music?.status !== "ready" || !project.music.fileName) {
    return NextResponse.json({ error: "Music not found." }, { status: 404 });
  }
  // Prevent path traversal; only the stored file name is allowed.
  const name = project.music.fileName;
  if (name.replace(/[^a-zA-Z0-9._-]/g, "") !== name) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }
  const full = path.join(projectDir(id), name);
  const ext = name.split(".").pop()?.toLowerCase() ?? "m4a";

  let size: number;
  try {
    size = (await fs.stat(full)).size;
  } catch {
    return NextResponse.json({ error: "Music file missing on disk." }, { status: 404 });
  }

  const baseHeaders: Record<string, string> = {
    "Content-Type": ext === "mp3" ? "audio/mpeg" : ext === "webm" ? "audio/webm" : "audio/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const startStr = match[1];
      const endStr = match[2];
      let start = startStr ? parseInt(startStr, 10) : 0;
      let end = endStr ? parseInt(endStr, 10) : size - 1;
      if (!startStr && endStr) {
        start = Math.max(0, size - parseInt(endStr, 10));
        end = size - 1;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
        end = Math.min(end, size - 1);
        const stream = createReadStream(full, { start, end });
        return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
    }
  }

  const stream = createReadStream(full);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
