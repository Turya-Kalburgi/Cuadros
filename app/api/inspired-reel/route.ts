import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { generateInspiredReel, type InspiredReelResult } from "@/lib/inspired";
import { downloadFromUrl, normalizeVideoUrl } from "@/lib/ingest";
import { resolveFfmpeg, resolveYtDlp } from "@/lib/binaries";
import { writeJson, readJson } from "@/lib/paths";

export const maxDuration = 300; // Allow up to 5 minutes execution

export type InspiredJobMeta = {
  id: string;
  status: "processing" | "ready" | "error";
  progress: number;
  detail: string;
  error?: string | null;
  targetDuration: number;
  inspiredUrl: string;
  inspiredTitle?: string;
  result?: InspiredReelResult | null;
  createdAt: string;
};

export async function POST(request: NextRequest) {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return NextResponse.json({ error: "FFmpeg is not installed." }, { status: 503 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const inspiredUrlRaw = String(formData.get("inspiredUrl") ?? "");
  const inspiredUrl = normalizeVideoUrl(inspiredUrlRaw);
  if (!inspiredUrl) {
    return NextResponse.json(
      { error: "Please provide a valid inspiration video URL (YouTube, Shorts, etc.)." },
      { status: 400 },
    );
  }

  const rawDuration = parseInt(String(formData.get("targetDuration") ?? "30"), 10);
  const targetDuration = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.min(60, Math.max(15, rawDuration)) : 30;

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const userLinksRaw = formData.getAll("userLinks").map(String);
  const userLinks = userLinksRaw.map(normalizeVideoUrl).filter((u): u is string => Boolean(u));

  if (files.length === 0 && userLinks.length === 0) {
    return NextResponse.json(
      { error: "Please upload at least one video clip or provide a footage link." },
      { status: 400 },
    );
  }

  const id = randomUUID();
  const jobDir = path.join(process.cwd(), "storage", "inspired", id);
  await fs.mkdir(jobDir, { recursive: true });

  const metaPath = path.join(jobDir, "meta.json");
  const meta: InspiredJobMeta = {
    id,
    status: "processing",
    progress: 5,
    detail: "Initializing inspired reel studio…",
    targetDuration,
    inspiredUrl,
    createdAt: new Date().toISOString(),
  };
  await writeJson(metaPath, meta);

  const updateJob = async (patch: Partial<InspiredJobMeta>) => {
    const curr = (await readJson<InspiredJobMeta>(metaPath)) ?? meta;
    const next = { ...curr, ...patch };
    await writeJson(metaPath, next);
  };

  // Run in background; client polls GET /api/inspired-reel/:id
  void (async () => {
    try {
      const ytDlp = await resolveYtDlp();
      if (!ytDlp) throw new Error("yt-dlp is not installed.");

      // 1. Download inspiration video
      await updateJob({ progress: 10, detail: "Downloading inspiration video & song track…" });
      const { filePath: inspiredVideoPath, title: inspiredTitle } = await downloadFromUrl(
        inspiredUrl,
        `inspired-${id}`,
      );

      // 2. Save user uploaded files to jobDir
      const userClips: Array<{ filePath: string; name: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = path.extname(file.name).slice(1) || "mp4";
        const userFilePath = path.join(jobDir, `user-clip-${i}.${ext}`);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(userFilePath, buffer);
        userClips.push({ filePath: userFilePath, name: file.name });
      }

      // 3. Download any user video links
      for (let i = 0; i < userLinks.length; i++) {
        const link = userLinks[i];
        await updateJob({
          progress: 20 + Math.round((i / userLinks.length) * 15),
          detail: `Downloading your video footage link ${i + 1}…`,
        });
        const { filePath, title } = await downloadFromUrl(link, `user-link-${id}-${i}`);
        userClips.push({ filePath, name: title || `Footage Link ${i + 1}` });
      }

      if (userClips.length === 0) {
        throw new Error("No valid footage clips available.");
      }

      // 4. Generate the Reel matching cuts & song
      const outputFile = path.join(jobDir, "reel.mp4");
      const result = await generateInspiredReel({
        id,
        userClips,
        inspiredVideoPath,
        inspiredTitle: inspiredTitle || "Inspiration Video",
        targetDuration,
        workDir: path.join(jobDir, "work"),
        outputFile,
        onProgress: (detail, pct) => {
          void updateJob({ progress: pct, detail });
        },
      });

      await updateJob({
        status: "ready",
        progress: 100,
        detail: "Ready!",
        inspiredTitle: inspiredTitle || "Inspiration Video",
        result,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Inspired reel generation failed.";
      await updateJob({
        status: "error",
        error: msg,
        detail: msg,
      });
    }
  })();

  return NextResponse.json({ job: meta }, { status: 201 });
}

