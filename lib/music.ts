import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { generateJson } from "./ai";
import { resolveYtDlp, ytDlpCommonArgs, ytDlpCookieVariants } from "./binaries";
import { PROJECT_ROOT } from "./paths";
import type { MusicSearchResult } from "./types";

const execFileAsync = promisify(execFile);
const SEP = "\x1f";
const MAX_RESULTS = 8;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

const cache = new Map<string, { at: number; results: MusicSearchResult[] }>();

export async function searchMusic(query: string): Promise<MusicSearchResult[]> {
  const q = query.trim().slice(0, 120);
  if (!q) return [];

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  const ytDlp = await resolveYtDlp();
  if (!ytDlp) return [];

  let stdout: string | null = null;
  for (const cookies of ytDlpCookieVariants()) {
    let output: string | null = null;
    try {
      const result = await execFileAsync(
        ytDlp,
        [
          ...ytDlpCommonArgs(),
          ...cookies,
          "--flat-playlist",
          "--no-warnings",
          "--socket-timeout",
          "8",
          "--playlist-end",
          String(MAX_RESULTS),
          "--print",
          `%(title)s${SEP}%(duration)s${SEP}%(id)s${SEP}%(channel)s`,
          `ytsearch${MAX_RESULTS}:${q}`,
        ],
        { timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONUNBUFFERED: "1" } },
      );
      output = result.stdout;
    } catch {
      output = null;
    }
    if (output !== null && output.trim()) {
      stdout = output;
      break;
    }
  }
  if (stdout === null) return [];

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
  return results;
}

export async function suggestMusicQuery(focus: string, titles: string[]): Promise<string> {
  const context = [focus, ...titles.slice(0, 5)].filter(Boolean).join(" ").trim();
  const fallback = `${context || "cinematic upbeat"} instrumental music`.slice(0, 120);
  const { data } = await generateJson(`You are choosing a YouTube search query for background music for a fast-cut highlight reel.
Creator focus and reel titles: ${context || "(none)"}
Respond with ONLY JSON: { "query": "2-6 words describing a music genre or mood, plus instrumental unless vocals are clearly wanted" }`);
  if (data && typeof data === "object") {
    const query = (data as { query?: unknown }).query;
    if (typeof query === "string" && query.trim()) return query.trim().slice(0, 120);
  }
  return fallback;
}

export function rankSongResults(
  results: MusicSearchResult[],
  target: { title: string; artist: string },
): MusicSearchResult[] {
  const bad = ["karaoke", "cover", "reaction", "tutorial", "sped up", "slowed", "lyric", "reverb", "remix"];
  const wanted = `${target.title} ${target.artist}`.toLowerCase();
  const wantedWords = wanted.split(/\W+/).filter((word) => word.length >= 3);
  const artist = target.artist.toLowerCase();
  const isBad = (item: MusicSearchResult) =>
    bad.some((word) => item.title.toLowerCase().includes(word));
  const clean = results.filter((item) => !isBad(item));
  const pool = clean.length > 0 ? clean : results;
  const score = (item: MusicSearchResult) => {
    const title = item.title.toLowerCase();
    const channel = (item.channel ?? "").toLowerCase();
    let value = 0;
    for (const word of wantedWords) if (title.includes(word)) value += 4;
    if (title.includes(target.title.toLowerCase())) value += 6;
    if (channel === artist) value += 12;
    else if (channel && artist.includes(channel)) value += 7;
    else if (channel && channel.includes(artist)) value += 7;
    if (/(official|audio|visualizer|vevo|topic)/i.test(title)) value += 6;
    if (isBad(item)) value -= 25;
    if (item.duration && item.duration >= 120 && item.duration <= 420) value += 3;
    return value;
  };
  return [...pool].sort((a, b) => score(b) - score(a));
}

export type SongBeats = {
  interval: number | null;
  bpm: number | null;
  phase: number;
  onsets: number[];
};

export async function analyzeSongBeats(file: string): Promise<SongBeats | null> {
  try {
    const { stdout } = await execFileAsync(
      "python3",
      [path.join(PROJECT_ROOT, "lib", "audio_beats.py"), "--audio", file],
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as SongBeats;
    return parsed.interval && parsed.interval > 0 ? parsed : null;
  } catch {
    return null;
  }
}

