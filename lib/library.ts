import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  ensureLibraryDirs,
  libraryClipDir,
  libraryIndexPath,
  readJson,
  writeJson,
} from "./paths";
import { probeMedia } from "./media";
import { extractMeanColor } from "./recreate-helpers";
import type { LibraryClip } from "./types";

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);
export const MAX_LIBRARY_CLIP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export function newLibraryId(): string {
  return randomUUID();
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "").trim();
  return base || "clip.mp4";
}

export function clipFileNameFor(clipId: string, originalName: string): string {
  const ext = path.extname(originalName).slice(1).toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : "mp4";
  return `${clipId}.${safeExt}`;
}

export async function loadLibraryIndex(): Promise<LibraryClip[]> {
  const index = await readJson<LibraryClip[]>(libraryIndexPath());
  if (!index || !Array.isArray(index)) return [];
  return index;
}

// Serializes read-modify-write cycles on the index so concurrent uploads
// can't clobber each other (last writer would otherwise drop clips).
let indexWriteQueue: Promise<unknown> = Promise.resolve();

async function withIndexLock<T>(fn: (clips: LibraryClip[]) => Promise<T>): Promise<T> {
  const run = indexWriteQueue.then(async () => fn(await loadLibraryIndex()));
  indexWriteQueue = run.catch(() => undefined);
  return run;
}

async function saveLibraryIndex(clips: LibraryClip[]): Promise<void> {
  await ensureLibraryDirs();
  await writeJson(libraryIndexPath(), clips);
}

export async function listLibraryClips(): Promise<LibraryClip[]> {
  const clips = await loadLibraryIndex();
  clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return clips;
}

export async function getLibraryClip(id: string): Promise<LibraryClip | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const clips = await loadLibraryIndex();
  return clips.find((c) => c.id === id) ?? null;
}

export async function libraryClipFilePath(clip: LibraryClip): Promise<string | null> {
  const dir = libraryClipDir(clip.id);
  try {
    const entries = await fs.readdir(dir);
    const file = entries.find((e) => e !== "thumb.jpg" && !e.endsWith(".json"));
    return file ? path.join(dir, file) : null;
  } catch {
    return null;
  }
}

export async function addLibraryClip(opts: {
  id: string;
  filePath: string;
  originalName: string;
  tags?: string[];
}): Promise<LibraryClip> {
  await ensureLibraryDirs();
  await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
  return finalizeLibraryClip({
    id: opts.id,
    filePath: opts.filePath,
    originalName: opts.originalName,
    tags: opts.tags ?? [],
  });
}

export async function finalizeLibraryClip(opts: {
  id: string;
  filePath: string;
  originalName: string;
  tags: string[];
}): Promise<LibraryClip> {
  const probe = await probeMedia(opts.filePath);
  const meanColor = await extractMeanColor(opts.filePath, probe.durationSeconds / 2).catch(
    () => null,
  );

  const clip: LibraryClip = {
    id: opts.id,
    name: sanitizeFileName(opts.originalName),
    fileName: path.basename(opts.filePath),
    durationSeconds: probe.durationSeconds,
    width: probe.width,
    height: probe.height,
    hasAudio: probe.hasAudio,
    createdAt: new Date().toISOString(),
    tags: opts.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12),
    meanColor,
  };

  // Generate a small thumbnail for UI
  try {
    const { generateClipThumbnail } = await import("./media");
    await generateClipThumbnail(opts.filePath, path.join(libraryClipDir(opts.id), "thumb.jpg"));
  } catch {
    /* thumbnail is best-effort */
  }

  const saved = await withIndexLock(async (index) => {
    index.push(clip);
    await saveLibraryIndex(index);
    return clip;
  });
  return saved;
}

export async function updateLibraryClipTags(id: string, tags: string[]): Promise<LibraryClip | null> {
  return withIndexLock(async (index) => {
    const clip = index.find((c) => c.id === id);
    if (!clip) return null;
    clip.tags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12);
    await saveLibraryIndex(index);
    return clip;
  });
}

export async function deleteLibraryClip(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const deleted = await withIndexLock(async (index) => {
    const next = index.filter((c) => c.id !== id);
    if (next.length === index.length) return false;
    await saveLibraryIndex(next);
    return true;
  });
  if (deleted) {
    await fs.rm(libraryClipDir(id), { recursive: true, force: true }).catch(() => undefined);
  }
  return deleted;
}

export async function getClipsByIds(ids: string[]): Promise<LibraryClip[]> {
  const index = await loadLibraryIndex();
  const map = new Map(index.map((c) => [c.id, c]));
  return ids.map((id) => map.get(id)).filter((c): c is LibraryClip => Boolean(c));
}
