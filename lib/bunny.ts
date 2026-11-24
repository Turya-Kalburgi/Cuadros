import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { STORAGE_ROOT } from "./paths";

const ZONE = process.env.BUNNY_STORAGE_ZONE?.trim() ?? "";
const API_KEY = process.env.BUNNY_API_KEY?.trim() ?? "";
const REGION = process.env.BUNNY_REGION?.trim() ?? "";
const CDN_BASE = process.env.BUNNY_CDN_BASE?.trim().replace(/\/$/, "") ?? "";
const API_BASE =
  process.env.BUNNY_STORAGE_API_URL?.trim().replace(/\/$/, "") ??
  (REGION ? `https://${REGION}.storage.bunnycdn.com` : "https://storage.bunnycdn.com");

export type BunnyStatus = {
  configured: boolean;
  zone: string | null;
  cdnBase: string | null;
  region: string | null;
};

export function bunnyStatus(): BunnyStatus {
  return {
    configured: Boolean(ZONE && API_KEY && CDN_BASE),
    zone: ZONE || null,
    cdnBase: CDN_BASE || null,
    region: REGION || null,
  };
}

export function bunnyConfigured(): boolean {
  return Boolean(ZONE && API_KEY && CDN_BASE);
}

export function storageApiConfigured(): boolean {
  return Boolean(ZONE && API_KEY);
}

function remotePath(localFile: string): string {
  const relative = path.relative(STORAGE_ROOT, localFile).split(path.sep).join("/");
  return relative.startsWith("..") ? path.basename(localFile) : relative;
}

function encodedPath(remote: string): string {
  return remote.split("/").map(encodeURIComponent).join("/");
}

export function bunnyUrl(remote: string): string {
  return CDN_BASE ? `${CDN_BASE}/${encodedPath(remote)}` : "";
}

export function bunnyUrlForFile(localFile: string): string {
  return bunnyUrl(remotePath(localFile));
}

export async function uploadToBunny(localFile: string): Promise<string | null> {
  if (!storageApiConfigured()) return null;
  const remote = remotePath(localFile);
  const target = `${API_BASE}/${encodeURIComponent(ZONE)}/${encodedPath(remote)}`;
  try {
    const stream = Readable.toWeb(createReadStream(localFile)) as ReadableStream;
    const response = await fetch(target, {
      method: "PUT",
      headers: { AccessKey: API_KEY, "Content-Type": "application/octet-stream" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!response.ok) return null;
    return bunnyUrl(remote);
  } catch {
    return null;
  }
}

export async function deleteFromBunny(localFile: string): Promise<boolean> {
  if (!storageApiConfigured()) return false;
  const target = `${API_BASE}/${encodeURIComponent(ZONE)}/${encodedPath(remotePath(localFile))}`;
  try {
    const response = await fetch(target, {
      method: "DELETE",
      headers: { AccessKey: API_KEY },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listLocalFiles(root?: string): Promise<string[]> {
  const base = root ?? STORAGE_ROOT;
  const found: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  await walk(base);
  return found;
}

export type SyncResult = { uploaded: number; failed: number; total: number };

export async function syncFilesToBunny(files: string[]): Promise<SyncResult> {
  let uploaded = 0;
  let failed = 0;
  for (const file of files) {
    const url = await uploadToBunny(file);
    if (url) uploaded++;
    else failed++;
  }
  return { uploaded, failed, total: files.length };
}
