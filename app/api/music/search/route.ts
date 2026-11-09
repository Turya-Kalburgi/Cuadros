import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { resolveYtDlp } from "@/lib/binaries";
import type { MusicSearchResult } from "@/lib/types";

const SEP = "\x1f";
const MAX_RESULTS = 8;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

const cache = new Map<string, { at: number; results: MusicSearchResult[] }>();

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!q) return NextResponse.json({ results: [] });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ results: hit.results });
  }

  const ytDlp = await resolveYtDlp();
  if (!ytDlp) {
    return NextResponse.json(
      { results: [], error: "yt-dlp is not installed." },
      { status: 503 },
    );
  }

  const args = [
    "--flat-playlist",
    "--no-warnings",
    "--socket-timeout",
    "8",
    "--playlist-end",
    String(MAX_RESULTS),
    "--print",
    `%(title)s${SEP}%(duration)s${SEP}%(id)s${SEP}%(channel)s`,
    `ytsearch${MAX_RESULTS}:${q}`,
  ];

  const stdout = await new Promise<string | null>((resolve) => {
    execFile(
      ytDlp,
      args,
      { timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONUNBUFFERED: "1" } },
      (err, out) => resolve(err ? null : out),
    );
  });
  if (stdout === null) return NextResponse.json({ results: [] });

  const results: MusicSearchResult[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(SEP);
    if (parts.length < 4) continue;
    const title = parts[0];
    const durRaw = parts[1];
    const id = parts[2];
    const channel = parts.slice(3).join(SEP) || null;
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) continue;
    const dur = durRaw === "NA" || durRaw === "None" ? Number.NaN : Number(durRaw);
    results.push({
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title,
      duration: Number.isFinite(dur) ? dur : null,
      channel,
    });
    if (results.length >= MAX_RESULTS) break;
  }

  cache.set(key, { at: Date.now(), results });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return NextResponse.json({ results });
}
