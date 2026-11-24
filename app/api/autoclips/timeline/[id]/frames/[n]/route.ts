import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { autoDir } from "@/lib/paths";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const index = Number(n);
  if (!Number.isInteger(index) || index < 1) {
    return NextResponse.json({ error: "Invalid frame" }, { status: 400 });
  }
  const file = path.join(autoDir(id), "frames", `frame-${String(index).padStart(3, "0")}.jpg`);
  try {
    await fs.access(file);
  } catch {
    return NextResponse.json({ error: "Frame not ready" }, { status: 404 });
  }
  const stream = createReadStream(file);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
