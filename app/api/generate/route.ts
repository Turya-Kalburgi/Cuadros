import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  GENERATE_STYLES,
  type GenerateJobMeta,
  type GenerateStyle,
} from "@/lib/types";
import {
  generateDir,
  generateMetaPath,
  generateRoot,
  generateVideoPath,
  readJson,
  writeJson,
} from "@/lib/paths";
import { planVideo, renderGeneratedVideo } from "@/lib/generate";
import { resolveFfmpeg } from "@/lib/binaries";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!(await resolveFfmpeg())) {
    return NextResponse.json(
      { error: "FFmpeg is not installed. Run `brew install ffmpeg` and restart the server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    prompt?: unknown;
    style?: unknown;
    targetDuration?: unknown;
    includeNarration?: unknown;
    includeAmbient?: unknown;
    includeCaptions?: unknown;
  } | null;
  const prompt = String(body?.prompt ?? "").trim();
  if (prompt.length < 4 || prompt.length > 4000) {
    return NextResponse.json(
      { error: "Describe your video in at least 4 characters (max 4000)." },
      { status: 400 },
    );
  }
  const style: GenerateStyle = GENERATE_STYLES.includes(body?.style as GenerateStyle)
    ? (body?.style as GenerateStyle)
    : "cinematic-warm";
  const rawDuration = Number(body?.targetDuration ?? 30);
  const targetDuration = Number.isFinite(rawDuration)
    ? Math.min(60, Math.max(15, Math.round(rawDuration)))
    : 30;
  const includeNarration = body?.includeNarration !== false;
  const includeAmbient = body?.includeAmbient !== false;
  const includeCaptions = body?.includeCaptions !== false;

  const id = randomUUID();
  const jobDir = generateDir(id);
  await fs.mkdir(path.join(jobDir, "work"), { recursive: true });
  const metaFile = generateMetaPath(id);
  const now = new Date().toISOString();
  const meta: GenerateJobMeta = {
    id,
    status: "planning",
    progress: 2,
    detail: "Queued…",
    prompt,
    style,
    targetDuration,
    includeNarration,
    includeAmbient,
    includeCaptions,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(metaFile, meta);

  const updateJob = async (patch: Partial<GenerateJobMeta>) => {
    const current = (await readJson<GenerateJobMeta>(metaFile)) ?? meta;
    await writeJson(metaFile, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  void (async () => {
    try {
      await updateJob({ status: "planning", progress: 8, detail: "Writing the shotlist…" });
      const { shotlist, aiUsed } = await planVideo({ prompt, style, targetDuration });
      await updateJob({
        shotlist,
        progress: 18,
        detail: `${shotlist.shots.length} scenes planned · ${aiUsed ? "AI shotlist" : "heuristic shotlist"}.`,
      });
      const result = await renderGeneratedVideo({
        shotlist,
        workDir: path.join(jobDir, "work"),
        outputFile: generateVideoPath(id),
        includeNarration,
        includeAmbient,
        includeCaptions,
        onProgress: (detail, pct) => void updateJob({ detail, progress: pct }),
      });
      await updateJob({
        status: "ready",
        progress: 100,
        detail: "Ready!",
        result: { fileName: path.basename(generateVideoPath(id)), ...result },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed.";
      await updateJob({ status: "error", error: message, detail: message });
    }
  })();

  return NextResponse.json({ job: meta }, { status: 201 });
}

export async function GET() {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(generateRoot());
  } catch {
    return NextResponse.json({ jobs: [] });
  }
  const jobs: GenerateJobMeta[] = [];
  for (const entry of entries) {
    const meta = await readJson<GenerateJobMeta>(generateMetaPath(entry));
    if (meta) jobs.push(meta);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ jobs: jobs.slice(0, 12) });
}
