import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { normalizeVideoUrl } from "@/lib/ingest";
import { resolveFfmpeg, resolveYtDlp } from "@/lib/binaries";
import {
  ensureRecreateDirs,
  readJson,
  recreateMetaPath,
  recreateRoot,
  writeJson,
} from "@/lib/paths";
import { getClipsByIds, libraryClipFilePath, listLibraryClips } from "@/lib/library";
import { runRecreateJob } from "@/lib/recreate";
import type { RecreateJobMeta } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return NextResponse.json({ error: "FFmpeg is not installed." }, { status: 503 });
  }
  const ytDlp = await resolveYtDlp();
  if (!ytDlp) {
    return NextResponse.json(
      { error: "yt-dlp is not installed. Run `brew install yt-dlp`." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    referenceUrl?: unknown;
    targetDuration?: unknown;
    libraryClipIds?: unknown;
    includeCaptions?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const referenceUrl = normalizeVideoUrl(String(body.referenceUrl ?? ""));
  if (!referenceUrl) {
    return NextResponse.json(
      { error: "Please paste a valid reel URL (Instagram, TikTok, YouTube Shorts…)." },
      { status: 400 },
    );
  }

  const rawDuration = Number(body.targetDuration ?? 30);
  const targetDuration = Number.isFinite(rawDuration)
    ? Math.min(60, Math.max(15, Math.round(rawDuration)))
    : 30;

  // Resolve clips: explicit selection, else entire library
  let clipIds: string[] = [];
  if (Array.isArray(body.libraryClipIds)) {
    clipIds = body.libraryClipIds
      .filter((x): x is string => typeof x === "string")
      .slice(0, 40);
  }
  if (clipIds.length === 0) {
    clipIds = (await listLibraryClips()).map((c) => c.id);
  }

  const clips = await getClipsByIds(clipIds);
  if (clips.length === 0) {
    return NextResponse.json(
      {
        error:
          "Your library is empty. Add clips in the Library tab first — AI needs your footage to recreate the reel.",
      },
      { status: 400 },
    );
  }

  const clipPaths = new Map<string, string>();
  for (const clip of clips) {
    const p = await libraryClipFilePath(clip);
    if (p) clipPaths.set(clip.id, p);
  }
  if (clipPaths.size === 0) {
    return NextResponse.json({ error: "Library clip files are missing on disk." }, { status: 500 });
  }

  const id = randomUUID();
  await ensureRecreateDirs(id);
  const metaFile = recreateMetaPath(id);
  const now = new Date().toISOString();
  const includeCaptions = body.includeCaptions !== false;
  const meta: RecreateJobMeta = {
    id,
    status: "downloading",
    progress: 2,
    detail: "Queued…",
    referenceUrl,
    targetDuration,
    libraryClipIds: clips.map((c) => c.id),
    includeCaptions,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(metaFile, meta);

  const updateJob = async (patch: Partial<RecreateJobMeta>) => {
    const curr = (await readJson<RecreateJobMeta>(metaFile)) ?? meta;
    const next = { ...curr, ...patch, updatedAt: new Date().toISOString() };
    await writeJson(metaFile, next);
  };

  // Background pipeline; client polls GET /api/recreate/:id
  void (async () => {
    try {
      const jobDir = (await import("@/lib/paths")).recreateDir(id);
      const result = await runRecreateJob({
        id,
        referenceUrl,
        targetDuration,
        clips,
        clipPaths,
        jobDir,
        workDir: `${jobDir}/work`,
        includeCaptions,
        onProgress: (patch) => updateJob(patch),
      });
      await updateJob({ status: "ready", progress: 100, detail: "Ready!", result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recreation failed.";
      await updateJob({ status: "error", error: msg, detail: msg });
    }
  })();

  return NextResponse.json({ job: meta }, { status: 201 });
}

export async function GET() {
  const root = recreateRoot();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return NextResponse.json({ jobs: [] });
  }
  const jobs: RecreateJobMeta[] = [];
  for (const entry of entries) {
    const meta = await readJson<RecreateJobMeta>(path.join(root, entry, "meta.json"));
    if (meta) jobs.push(meta);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ jobs: jobs.slice(0, 12) });
}
