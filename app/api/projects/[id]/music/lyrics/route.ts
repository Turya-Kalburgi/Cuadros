import { NextRequest, NextResponse } from "next/server";
import { loadProject, saveProject } from "@/lib/store";
import type { LyricLine } from "@/lib/types";

const LRCLIB_AGENT = "cuadros/1.0 (cuadros.ai; video studio)";
const MIN_LINES = 4;
const DURATION_MATCH_TOLERANCE = 5;
const EXACT_DURATION_TOLERANCE = 10;

type LrclibEntry = {
  trackName?: string;
  duration?: number | null;
  syncedLyrics?: string | null;
};

function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let offsetMs = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const offsetMatch = /^\[offset:([+-]?\d+)\]/i.exec(line);
    if (offsetMatch) {
      offsetMs = parseInt(offsetMatch[1], 10);
      continue;
    }
    const tagRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    let lastIdx = 0;
    while ((m = tagRe.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3] ?? "0";
      const frac = parseInt(fracRaw.padEnd(3, "0").slice(0, 3), 10) / 1000;
      times.push(min * 60 + sec + frac);
      lastIdx = tagRe.lastIndex;
    }
    if (times.length === 0) continue;
    const textPart = line.slice(lastIdx).trim();
    if (!textPart) continue;
    for (const t of times) {
      lines.push({ t: Math.max(0, t + offsetMs / 1000), text: textPart });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
}

async function searchLrclib(q: string): Promise<LrclibEntry[]> {
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": LRCLIB_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data as LrclibEntry[];
  } catch {
    return [];
  }
}

async function getLrclibExact(artist: string, track: string): Promise<LrclibEntry | null> {
  try {
    const url =
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}` +
      `&track_name=${encodeURIComponent(track)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": LRCLIB_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LrclibEntry;
    return data?.syncedLyrics ? data : null;
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (project.music?.status !== "ready" || !project.music.title) {
    return NextResponse.json({ error: "No track imported yet." }, { status: 409 });
  }

  if (project.music.lyrics) {
    return NextResponse.json({ lines: project.music.lyrics.lines });
  }

  const title = project.music.title;
  const stripped = title.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/g, "").trim();
  const musicDur = project.music.durationSeconds ?? null;

  let chosen: LrclibEntry | null = null;

  // 1) Exact match when the title looks like "Artist - Track".
  const exact = /^(.+?)\s+[-–—]\s+(.+)$/.exec(stripped);
  if (exact) {
    const entry = await getLrclibExact(exact[1].trim(), exact[2].trim());
    const diffOk =
      !entry ||
      !musicDur ||
      !entry.duration ||
      Math.abs(entry.duration - musicDur) <= EXACT_DURATION_TOLERANCE;
    if (entry && diffOk) chosen = entry;
  }

  // 2) Fuzzy search, preferring entries whose duration matches our audio.
  if (!chosen) {
    const queries = Array.from(new Set([title, stripped].filter(Boolean)));
    let bestSynced: LrclibEntry | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    let fallbackSynced: LrclibEntry | null = null;

    for (const q of queries) {
      const entries = await searchLrclib(q);
      for (const entry of entries) {
        if (!entry.syncedLyrics) continue;
        if (!fallbackSynced) fallbackSynced = entry;
        if (musicDur && entry.duration) {
          const diff = Math.abs(entry.duration - musicDur);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestSynced = entry;
          }
        }
      }
      if (bestSynced && bestDiff <= DURATION_MATCH_TOLERANCE) break;
    }

    chosen =
      bestSynced && bestDiff <= DURATION_MATCH_TOLERANCE ? bestSynced : fallbackSynced;
  }

  if (!chosen?.syncedLyrics) {
    return NextResponse.json({ lines: [] });
  }

  const lines = parseLrc(chosen.syncedLyrics);
  if (lines.length < MIN_LINES) {
    return NextResponse.json({ lines: [] });
  }

  // Cache on the project so we only hit LRCLIB once per track.
  project.music.lyrics = { source: "lrclib", lines };
  await saveProject(project);
  return NextResponse.json({ lines });
}
