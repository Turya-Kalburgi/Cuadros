import { NextRequest, NextResponse } from "next/server";
import { readJson, generateMetaPath } from "@/lib/paths";
import type { GenerateJobMeta } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const job = await readJson<GenerateJobMeta>(generateMetaPath(id));
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
