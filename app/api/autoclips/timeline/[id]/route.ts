import { NextResponse } from "next/server";
import { autoMetaPath, readJson } from "@/lib/paths";
import type { TimelineJobMeta } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const job = await readJson<TimelineJobMeta>(autoMetaPath(id));
  if (!job) return NextResponse.json({ error: "Timeline not found" }, { status: 404 });
  return NextResponse.json({ job });
}
