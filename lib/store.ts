import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { ensureProjectDirs, metaPath, readJson, writeJson, STORAGE_ROOT } from "./paths";
import type { ExportJob, ProjectMeta } from "./types";

export function newId(): string {
  return randomUUID();
}

export async function saveProject(meta: ProjectMeta): Promise<void> {
  await ensureProjectDirs(meta.id);
  await writeJson(metaPath(meta.id), meta);
}

export async function loadProject(id: string): Promise<ProjectMeta | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return readJson<ProjectMeta>(metaPath(id));
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const dir = path.join(STORAGE_ROOT, "projects");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const metas: ProjectMeta[] = [];
  for (const entry of entries) {
    const meta = await readJson<ProjectMeta>(path.join(dir, entry, "meta.json"));
    if (meta) metas.push(meta);
  }
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas;
}

export function projectFilePath(id: string, name: string): string {
  return path.join(STORAGE_ROOT, "projects", id, name);
}

export type { ExportJob, ProjectMeta };
