import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { loadProject } from "@/lib/store";
import { thumbsDir } from "@/lib/paths";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const index = Number(n);
  if (!Number.isInteger(index) || index < 0 || index >= project.thumbCount) {
    return NextResponse.json({ error: "Thumbnail not found." }, { status: 404 });
  }
  const file = `${thumbsDir(id)}/thumb-${String(index).padStart(3, "0")}.jpg`;
  try {
    const data = await fs.readFile(file);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Thumbnail not found." }, { status: 404 });
  }
}
