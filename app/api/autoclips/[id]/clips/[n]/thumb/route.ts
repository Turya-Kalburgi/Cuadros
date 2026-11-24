import { NextRequest, NextResponse } from "next/server";
import { createReadStream, promises as fs } from "fs";
import { Readable } from "stream";
import { autoClipPath } from "@/lib/paths";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const index = Number(n);
  if (!Number.isInteger(index) || index < 1 || index > 5) {
    return NextResponse.json({ error: "Invalid clip number" }, { status: 400 });
  }

  const thumbPath = autoClipPath(id, `clip-${index}.jpg`);
  try {
    await fs.access(thumbPath);
  } catch {
    return NextResponse.json({ error: "Thumbnail not ready yet." }, { status: 404 });
  }

  const stream = createReadStream(thumbPath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
