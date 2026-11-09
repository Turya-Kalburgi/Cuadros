import { NextRequest, NextResponse } from "next/server";
import { newId, saveProject } from "@/lib/store";
import { ensureProjectDirs } from "@/lib/paths";
import type { ProjectMeta } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    title?: string;
    itemCount?: number;
  } | null;

  const id = newId();
  await ensureProjectDirs(id);

  const title = (body?.title ?? "").trim() || "Multi-Clip Reel";

  const meta: ProjectMeta = {
    id,
    originalName: title,
    createdAt: new Date().toISOString(),
    durationSeconds: 0,
    width: 0,
    height: 0,
    fps: null,
    hasAudio: false,
    videoCodec: null,
    audioCodec: null,
    thumbCount: 0,
    thumbInterval: 0,
    exports: [],
    ingest: { status: "downloading", progress: 0, detail: "Preparing project parts…" },
  };

  await saveProject(meta);
  return NextResponse.json({ project: meta }, { status: 201 });
}

