import { NextRequest, NextResponse } from "next/server";
import { readJson, inspiredMetaPath } from "@/lib/paths";
import type { InspiredJobMeta } from "../route";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const meta = await readJson<InspiredJobMeta>(inspiredMetaPath(id));
  if (!meta) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job: meta });
}

