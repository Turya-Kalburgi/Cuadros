import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { loadProject } from "@/lib/store";
import { projectDir } from "@/lib/paths";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

async function findSource(id: string): Promise<{ file: string; ext: string } | null> {
  try {
    const entries = await fs.readdir(projectDir(id));
    const name = entries.find((e) => e.startsWith("source.") && !e.endsWith(".uploading"));
    if (!name) return null;
    return { file: path.join(projectDir(id), name), ext: name.split(".").pop()?.toLowerCase() ?? "mp4" };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project || project.ingest?.status === "downloading" || project.ingest?.status === "processing") {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const source = await findSource(id);
  if (!source) {
    return NextResponse.json({ error: "Source file missing on disk." }, { status: 404 });
  }

  let size: number;
  try {
    size = (await fs.stat(source.file)).size;
  } catch {
    return NextResponse.json({ error: "Source file missing on disk." }, { status: 404 });
  }

  const baseHeaders: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[source.ext] ?? "video/mp4",
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
        const stream = createReadStream(source.file, { start, end });
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

  const stream = createReadStream(source.file);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
