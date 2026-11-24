import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { PROJECT_ROOT, STORAGE_ROOT } from "./paths";

const execFileAsync = promisify(execFile);
const AUDIO_DIR = path.join(STORAGE_ROOT, "audio");
const SCRIPT = path.join(PROJECT_ROOT, "lib", "fallback_audio.py");

const TRACKS = [
  { file: "cozy-lofi.wav", title: "Cozy Lo-Fi (built-in)", moods: ["cozy", "trending"] },
  { file: "warm-piano.wav", title: "Warm Piano (built-in)", moods: ["cozy", "cinematic"] },
  { file: "cinematic-pad.wav", title: "Cinematic Pad (built-in)", moods: ["cinematic"] },
  { file: "upbeat-groove.wav", title: "Upbeat Groove (built-in)", moods: ["trending"] },
  { file: "calm-ambient.wav", title: "Calm Ambient (built-in)", moods: ["cozy", "cinematic"] },
  { file: "night-rain.wav", title: "Night Rain (built-in)", moods: ["cozy", "cinematic"] },
];

export type FallbackTrack = { file: string; title: string };

let generation: Promise<void> | null = null;

async function ensureTracks(): Promise<void> {
  if (!generation) {
    generation = (async () => {
      await fs.mkdir(AUDIO_DIR, { recursive: true });
      await execFileAsync("python3", [SCRIPT, AUDIO_DIR], {
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
      });
    })();
  }
  await generation;
}

export async function pickFallbackTrack(
  mood: string,
  context: string,
): Promise<FallbackTrack | null> {
  try {
    await ensureTracks();
    const pool = TRACKS.filter((track) => track.moods.includes(mood));
    const candidates = pool.length > 0 ? pool : TRACKS;
    const seed = [...context].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const choice = candidates[seed % candidates.length];
    const file = path.join(AUDIO_DIR, choice.file);
    await fs.access(file);
    return { file, title: choice.title };
  } catch {
    generation = null;
    return null;
  }
}
