import { NextRequest, NextResponse } from "next/server";
import { autoMetaPath, readJson } from "@/lib/paths";
import { buildInstagramCaption } from "@/lib/caption";
import type { AutoClipJobMeta } from "@/lib/types";

export async function GET(
  request: NextRequest,
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
  const job = await readJson<AutoClipJobMeta>(autoMetaPath(id));
  const clip = job?.clips?.[index - 1];
  if (!job || !clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  const caption = buildInstagramCaption({
    title: clip.title,
    focus: job.focus ?? "",
    song: job.music?.suggestion ?? job.music?.title ?? null,
    index,
  });
  return NextResponse.json({ caption });
}
