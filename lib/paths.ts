import { readFileSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Storage must live in the project's own folder no matter where the process
 * was launched from (e.g. `next dev` started in a parent directory) — otherwise
 * uploads and reads land in different roots and the library "forgets" clips.
 */
function resolveStorageRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "cuadros" || pkg.name === "framemuse") return path.join(dir, "storage");
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), "storage");
}

const RESOLVED_STORAGE_ROOT = resolveStorageRoot();

export const STORAGE_ROOT = RESOLVED_STORAGE_ROOT;
export const PROJECT_ROOT = path.dirname(RESOLVED_STORAGE_ROOT);

export function projectDir(id: string): string {
  return path.join(STORAGE_ROOT, "projects", id);
}

export function sourcePath(id: string, ext: string): string {
  return path.join(projectDir(id), `source.${ext}`);
}

export async function findSourceFile(id: string): Promise<{ file: string; ext: string } | null> {
  try {
    const entries = await fs.readdir(projectDir(id));
    const name = entries.find((e) => e.startsWith("source.") && !e.endsWith(".uploading"));
    if (!name) return null;
    return {
      file: path.join(projectDir(id), name),
      ext: name.split(".").pop()?.toLowerCase() ?? "mp4",
    };
  } catch {
    return null;
  }
}

export function thumbsDir(id: string): string {
  return path.join(projectDir(id), "thumbs");
}

export function exportsDir(id: string): string {
  return path.join(projectDir(id), "exports");
}

export function partsDir(id: string): string {
  return path.join(projectDir(id), "parts");
}

export function metaPath(id: string): string {
  return path.join(projectDir(id), "meta.json");
}

export async function ensureProjectDirs(id: string): Promise<void> {
  await fs.mkdir(thumbsDir(id), { recursive: true });
  await fs.mkdir(exportsDir(id), { recursive: true });
  await fs.mkdir(partsDir(id), { recursive: true });
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function libraryDir(): string {
  return path.join(STORAGE_ROOT, "library");
}

export function libraryClipDir(clipId: string): string {
  return path.join(libraryDir(), clipId);
}

export function libraryIndexPath(): string {
  return path.join(libraryDir(), "index.json");
}

export function recreateDir(id: string): string {
  return path.join(STORAGE_ROOT, "recreate", id);
}

export function recreateRoot(): string {
  return path.join(STORAGE_ROOT, "recreate");
}

export function recreateMetaPath(id: string): string {
  return path.join(recreateDir(id), "meta.json");
}

export function autoRoot(): string {
  return path.join(STORAGE_ROOT, "autoclips");
}

export function autoDir(id: string): string {
  return path.join(autoRoot(), id);
}

export function autoMetaPath(id: string): string {
  return path.join(autoDir(id), "meta.json");
}

export function autoClipPath(id: string, fileName: string): string {
  return path.join(autoDir(id), fileName);
}

export function generateRoot(): string {
  return path.join(STORAGE_ROOT, "generated");
}

export function generateDir(id: string): string {
  return path.join(generateRoot(), id);
}

export function generateMetaPath(id: string): string {
  return path.join(generateDir(id), "meta.json");
}

export function generateVideoPath(id: string): string {
  return path.join(generateDir(id), "video.mp4");
}

export function inspiredDir(id: string): string {
  return path.join(STORAGE_ROOT, "inspired", id);
}

export function inspiredMetaPath(id: string): string {
  return path.join(inspiredDir(id), "meta.json");
}

export function inspiredVideoPath(id: string): string {
  return path.join(inspiredDir(id), "reel.mp4");
}

export async function ensureLibraryDirs(): Promise<void> {
  await fs.mkdir(libraryDir(), { recursive: true });
}

export async function ensureRecreateDirs(id: string): Promise<void> {
  await fs.mkdir(path.join(recreateDir(id), "work"), { recursive: true });
}
