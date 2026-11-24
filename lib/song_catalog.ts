export * from "./song_list";

import { promises as fs } from "fs";
import path from "path";
import { readJson, STORAGE_ROOT, writeJson } from "./paths";
import type { SongMood } from "./song_list";

export type MusicFeedback = {
  focus: string;
  mood: SongMood;
  title: string;
  url: string;
  at: string;
};

const FEEDBACK_FILE = path.join(STORAGE_ROOT, "music-feedback.json");

export async function recordMusicChoice(
  focus: string,
  mood: SongMood,
  title: string,
  url: string,
): Promise<void> {
  if (!title.trim() || !url.trim()) return;
  try {
    const previous = (await readJson<MusicFeedback[]>(FEEDBACK_FILE)) ?? [];
    const entry: MusicFeedback = {
      focus: focus.slice(0, 200),
      mood,
      title: title.slice(0, 200),
      url,
      at: new Date().toISOString(),
    };
    const next = [entry, ...previous.filter((item) => item.url !== url)].slice(0, 100);
    await fs.mkdir(path.dirname(FEEDBACK_FILE), { recursive: true });
    await writeJson(FEEDBACK_FILE, next);
  } catch {
    /* learning is best-effort */
  }
}

export async function learnedMusicChoice(
  focus: string,
  mood: SongMood,
): Promise<MusicFeedback | null> {
  try {
    const history = (await readJson<MusicFeedback[]>(FEEDBACK_FILE)) ?? [];
    const words = focus.toLowerCase().split(/\W+/).filter((word) => word.length >= 4);
    let best: MusicFeedback | null = null;
    let bestScore = 0;
    for (const entry of history) {
      if (entry.mood !== mood) continue;
      if (/lyric|cover|karaoke|slowed|reverb|remix/i.test(entry.title)) continue;
      const hay = entry.focus.toLowerCase();
      const score = words.reduce((sum, word) => sum + (hay.includes(word) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return bestScore > 0 ? best : null;
  } catch {
    return null;
  }
}
