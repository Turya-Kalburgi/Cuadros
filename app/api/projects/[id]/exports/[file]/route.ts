import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fs } from "fs";
import { Readable } from "stream";
import { loadProject } from "@/lib/store";
import { exportsDir } from "@/lib/paths";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  // Prevent path traversal; only serve files that belong to a finished job.
  const safe = file.replace(/[^a-zA-Z0-9._-]/g, "");
  if (safe !== file) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }
  const isExport = project.exports.some((e) => e.outputFile === file && e.status === "done");
  if (!isExport) {
    return NextResponse.json({ error: "Export not found." }, { status: 404 });
  }

  const full = `${exportsDir(id)}/${file}`;
  let size: number;
  try {
    size = (await fs.stat(full)).size;
  } catch {
    return NextResponse.json({ error: "Export file missing on disk." }, { status: 404 });
  }

  const range = request.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const startStr = match[1];
      const endStr = match[2];
      let start = startStr ? parseInt(startStr, 10) : 0;
      let end = endStr ? parseInt(endStr, 10) : size - 1;
      if (!startStr && endStr) {
        // suffix range: last N bytes
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
