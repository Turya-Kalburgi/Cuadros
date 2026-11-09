import type { LibraryClip, ReelAnalysis, RecreateBeat } from "./types";

/**
 * AI layer for reel recreation.
 * Supports OpenAI (GPT-4o) and Gemini when API keys are present.
 * Falls back to deterministic heuristics so the product works with zero keys.
 */

export type AiProvider = "openai" | "gemini" | "none";

export function detectAiProvider(): AiProvider {
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return "none";
}

export function aiProviderLabel(): string {
  const p = detectAiProvider();
  if (p === "openai") return "GPT-4o";
  if (p === "gemini") return "Gemini";
  return "Smart heuristics (no AI key set)";
}

type FrameSample = { atSeconds: number; base64Jpeg: string };

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function callOpenAI(opts: {
  prompt: string;
  frames?: FrameSample[];
  json: boolean;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const content: Array<Record<string, unknown>> = [{ type: "text", text: opts.prompt }];
  for (const f of opts.frames ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${f.base64Jpeg}` },
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a short-form video editor who analyzes viral Instagram Reels. Always respond with valid JSON only, no markdown fences.",
          },
          { role: "user", content },
        ],
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        temperature: 0.6,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function callGemini(opts: {
  prompt: string;
  frames?: FrameSample[];
}): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }];
  for (const f of opts.frames ?? []) {
    parts.push({
      inline_data: { mime_type: "image/jpeg", data: f.base64Jpeg },
    });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.6,
          },
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    let text = raw.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Reel analysis (creative DNA)
// ---------------------------------------------------------------------------

export type AnalyzeReelInput = {
  durationSeconds: number;
  sceneCuts: number[];
  hasVoice: boolean;
  frames: FrameSample[];
};

type AiAnalysisShape = {
  hook?: string;
  vibe?: string;
  colorMood?: string;
  captionStyle?: { position?: string; energy?: string };
  structureBeats?: string[];
  shotHints?: string[];
};

const VALID_BEATS = new Set<RecreateBeat>(["hook", "setup", "build", "payoff", "cta"]);

function clampBeat(raw: unknown, fallback: RecreateBeat): RecreateBeat {
  const s = String(raw ?? "").toLowerCase().trim();
  return VALID_BEATS.has(s as RecreateBeat) ? (s as RecreateBeat) : fallback;
}

export async function analyzeReel(input: AnalyzeReelInput): Promise<{
  analysis: Omit<
    ReelAnalysis,
    "durationSeconds" | "sceneCuts" | "hasVoice" | "pacing" | "aiUsed"
  >;
  aiUsed: boolean;
}> {
  const provider = detectAiProvider();
  const beats = input.sceneCuts.length + 1;
  const fallbackBeats = Array.from(
    { length: Math.min(9, Math.max(3, beats)) },
    (_, i): RecreateBeat => {
      const len = Math.min(9, Math.max(3, beats));
      if (i === 0) return "hook";
      if (i === len - 1) return "cta";
      return i < len / 2 ? "setup" : "build";
    },
  );

  if (provider !== "none" && input.frames.length > 0) {
    const prompt = `You are analyzing a viral short-form reel (Instagram Reels / TikTok style) for a recreation tool.
The video is ${input.durationSeconds.toFixed(1)}s with ${input.sceneCuts.length} scene cuts at: [${input.sceneCuts.map((c) => c.toFixed(1)).join(", ")}] seconds.
It ${input.hasVoice ? "has" : "does not have"} voice-over/speech.

Look at the attached keyframes in order. Respond with ONLY this JSON shape:
{
  "hook": "1-2 sentence description of what the first seconds do to stop the scroll",
  "vibe": "3-6 word aesthetic/mood of the reel",
  "colorMood": "3-6 word color/lighting mood (e.g. warm golden hour, cool moody teal)",
  "captionStyle": { "position": "top|center|bottom", "energy": "punchy|chill|hype" },
  "structureBeats": ["hook","setup","build","payoff","cta"],
  "shotHints": ["short phrase describing the kind of footage that fits each scene, in order"]
}
structureBeats must have exactly ${fallbackBeats.length} entries. shotHints must also have exactly ${fallbackBeats.length} entries.
Model the TECHNIQUE, not the words — do not transcribe on-screen text.`;

    const raw = provider === "openai" ? await callOpenAI({ prompt, frames: input.frames, json: true }) : await callGemini({ prompt, frames: input.frames });
    const parsed = parseJson<AiAnalysisShape>(raw);
    if (parsed) {
      const structureBeats = (parsed.structureBeats ?? []).map((b, i) =>
        clampBeat(b, fallbackBeats[i] ?? "build"),
      );
      const shotHints = (parsed.shotHints ?? []).map(String);
      const length = Math.max(structureBeats.length, shotHints.length, fallbackBeats.length);
      while (structureBeats.length < length) structureBeats.push("build");
      while (shotHints.length < length) shotHints.push("");

      return {
        analysis: {
          hook: String(parsed.hook ?? "").slice(0, 240) || "Pattern-interrupt opening.",
          vibe: String(parsed.vibe ?? "").slice(0, 60) || "cinematic",
          colorMood: String(parsed.colorMood ?? "").slice(0, 60) || "balanced",
          captionStyle: {
            position:
              parsed.captionStyle?.position === "top" || parsed.captionStyle?.position === "center"
                ? parsed.captionStyle.position
                : "bottom",
            energy:
              parsed.captionStyle?.energy === "chill" || parsed.captionStyle?.energy === "hype"
                ? parsed.captionStyle.energy
                : "punchy",
          },
          structureBeats: structureBeats.slice(0, 12),
          shotHints: shotHints.slice(0, 12),
        },
        aiUsed: true,
      };
    }
  }

  // Heuristic fallback
  return {
    analysis: {
      hook: "Pattern-interrupt opening that stops the scroll in the first second.",
      vibe: "cinematic punch",
      colorMood: "high-contrast modern",
      captionStyle: { position: "bottom", energy: "punchy" },
      structureBeats: fallbackBeats,
      shotHints: fallbackBeats.map((b) => {
        switch (b) {
          case "hook":
            return "bold close-up or striking motion";
          case "setup":
            return "establishing or context shot";
          case "build":
            return "escalating action or detail shot";
          case "payoff":
            return "hero reveal or satisfying moment";
          case "cta":
            return "final beauty shot or wave-off";
        }
      }),
    },
    aiUsed: false,
  };
}

// ---------------------------------------------------------------------------
// Stage 3: Shot planning — pick clips + write captions
// ---------------------------------------------------------------------------

export type PlanShotsInput = {
  analysis: ReelAnalysis;
  shots: Array<{ index: number; beat: RecreateBeat; durationSeconds: number; startAt: number; sourceHint: string }>;
  clips: LibraryClip[];
  targetDuration: number;
  /** Reference-reel average color; boosts clips whose vibe matches. */
  refColor?: { r: number; g: number; b: number } | null;
};

type AiPlanShape = {
  shots?: Array<{ index?: number; clipIndex?: number; captionText?: string }>;
};

type Assignment = { index: number; clipIndex: number | null; captionText: string };

/** Clips may be a bit shorter than the shot — the renderer slows them down to fit. */
function eligibleForShot(clip: LibraryClip, shotDuration: number): boolean {
  return clip.durationSeconds + 0.05 >= shotDuration * 0.7;
}

function heuristicCaptions(
  beat: RecreateBeat,
  energy: ReelAnalysis["captionStyle"]["energy"],
  avoid?: string,
): string {
  const pools: Record<RecreateBeat, string[]> = {
    hook: energy === "chill" ? ["wait for it…", "you need to see this", "this changed everything"] : ["STOP SCROLLING", "this is different", "nobody talks about this"],
    setup: energy === "chill" ? ["here's the setup", "let me show you", "so picture this"] : ["here's what happened", "watch this", "no way"],
    build: energy === "hype" ? ["it gets better", "now watch", "WAIT"] : ["and then…", "keep watching", "plot twist incoming"],
    payoff: energy === "chill" ? ["and there it is", "perfectly done", "just like that"] : ["THAT'S the moment", "unreal", "nailed it"],
    cta: ["follow for part 2", "save this for later", "try it yourself"],
  };
  const list = pools[beat];
  const candidates = avoid ? list.filter((c) => c !== avoid) : list;
  const pool = candidates.length > 0 ? candidates : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

const BEAT_WORDS: Record<RecreateBeat, string[]> = {
  hook: ["hook", "intro", "open", "start", "face", "close"],
  setup: ["setup", "wide", "establish", "scene", "place"],
  build: ["build", "action", "move", "detail", "process"],
  payoff: ["payoff", "reveal", "result", "hero", "best", "win"],
  cta: ["end", "cta", "outro", "wave", "bye", "final"],
};

/**
 * Enforces reel variety on ANY assignment source (heuristic or AI):
 *  - never the same clip twice in a row (when an alternative exists)
 *  - never the same clip within the last 2 shots (when an alternative exists)
 *  - each clip used at most ceil(shots/clips) times before others rotate in
 */
function enforceVariety(
  assignments: Assignment[],
  shots: PlanShotsInput["shots"],
  clips: LibraryClip[],
): void {
  const n = assignments.length;
  if (n === 0 || clips.length === 0) return;
  const cap = Math.max(1, Math.ceil(n / clips.length));
  const counts = new Map<number, number>();
  for (const a of assignments) {
    if (a.clipIndex !== null) counts.set(a.clipIndex, (counts.get(a.clipIndex) ?? 0) + 1);
  }

  const clipAt = (shotIdx: number): number | null => assignments[shotIdx]?.clipIndex ?? null;

  for (let i = 0; i < n; i++) {
    const shot = shots[i] ?? shots[shots.length - 1];
    const current = assignments[i].clipIndex;
    const prev1 = i > 0 ? clipAt(i - 1) : null;
    const prev2 = i > 1 ? clipAt(i - 2) : null;

    const violates =
      current === null ||
      current === prev1 ||
      current === prev2 ||
      (counts.get(current) ?? 0) > cap;
    if (!violates) continue;

    // Choose the best alternative: eligible, not recent, under cap — then by fit.
    let bestCi = -1;
    let bestScore = -Infinity;
    for (let ci = 0; ci < clips.length; ci++) {
      if (ci === current) continue;
      if (!eligibleForShot(clips[ci], shot.durationSeconds)) continue;
      if (ci === prev1 || ci === prev2) continue;
      if ((counts.get(ci) ?? 0) >= cap) continue;
      let score = 0;
      const ratio = clips[ci].durationSeconds / Math.max(0.4, shot.durationSeconds);
      score += ratio >= 1 && ratio <= 4 ? 2 : ratio > 4 ? 0.5 : 0;
      score -= (counts.get(ci) ?? 0);
      const hay = `${clips[ci].name} ${clips[ci].tags.join(" ")}`.toLowerCase();
      if (BEAT_WORDS[shot.beat]?.some((w) => hay.includes(w))) score += 2.5;
      if (score > bestScore) {
        bestScore = score;
        bestCi = ci;
      }
    }

    if (bestCi >= 0) {
      if (current !== null) counts.set(current, Math.max(0, (counts.get(current) ?? 1) - 1));
      assignments[i].clipIndex = bestCi;
      counts.set(bestCi, (counts.get(bestCi) ?? 0) + 1);
    }
  }
}

export async function planShots(input: PlanShotsInput): Promise<{ planShots: Assignment[]; aiUsed: boolean }> {
  const provider = detectAiProvider();
  const fallback: Assignment[] = [];
  {
    let prevCaption = "";
    for (const s of input.shots) {
      const captionText = heuristicCaptions(s.beat, input.analysis.captionStyle.energy, prevCaption);
      prevCaption = captionText;
      fallback.push({ index: s.index, clipIndex: null, captionText });
    }
  }

  const colorScore = (clip: LibraryClip): number => {
    if (!input.refColor || !clip.meanColor) return 0;
    const dr = clip.meanColor.r - input.refColor.r;
    const dg = clip.meanColor.g - input.refColor.g;
    const db = clip.meanColor.b - input.refColor.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441;
    return dist < 0.22 ? 1.6 : dist < 0.35 ? 0.6 : 0;
  };

  // Greedy assignment with hard variety constraints.
  const assignHeuristic = () => {
    const n = input.shots.length;
    const cap = Math.max(1, Math.ceil(n / Math.max(1, input.clips.length)));
    const useCount = new Map<number, number>();
    const assignedBy: number[] = []; // clip index chosen for each shot, in order

    for (const shot of input.shots) {
      const eligibleIdx = input.clips
        .map((c, ci) => ci)
        .filter((ci) => eligibleForShot(input.clips[ci], shot.durationSeconds));
      if (eligibleIdx.length === 0) continue;

      const underCap = eligibleIdx.filter((ci) => (useCount.get(ci) ?? 0) < cap);
      const notRecent = (pool: number[]) =>
        pool.filter((ci) => {
          const last = assignedBy.length;
          const p1 = last >= 1 ? assignedBy[last - 1] : undefined;
          const p2 = last >= 2 ? assignedBy[last - 2] : undefined;
          return ci !== p1 && ci !== p2;
        });
      let pool = notRecent(underCap.length > 0 ? underCap : eligibleIdx);
      if (pool.length === 0) pool = notRecent(eligibleIdx);
      if (pool.length === 0) pool = underCap.length > 0 ? underCap : eligibleIdx;

      let bestCi = -1;
      let bestScore = -Infinity;
      for (const ci of pool) {
        const clip = input.clips[ci];
        let score = 0;
        const ratio = clip.durationSeconds / Math.max(0.4, shot.durationSeconds);
        score += ratio >= 1 && ratio <= 4 ? 2 : ratio > 4 ? 0.5 : 0;
        score -= (useCount.get(ci) ?? 0) * 4;
        const hay = `${clip.name} ${clip.tags.join(" ")}`.toLowerCase();
        if (BEAT_WORDS[shot.beat].some((w) => hay.includes(w))) score += 2.5;
        score += colorScore(clip);
        if (shot.index === 0 && (useCount.get(ci) ?? 0) === 0) score += 1;
        if (score > bestScore) {
          bestScore = score;
          bestCi = ci;
        }
      }
      if (bestCi >= 0) {
        fallback[shot.index].clipIndex = bestCi;
        useCount.set(bestCi, (useCount.get(bestCi) ?? 0) + 1);
        assignedBy.push(bestCi);
      }
    }
    // Fill any unassigned shots round-robin over eligible clips
    let rr = 0;
    for (let i = 0; i < fallback.length; i++) {
      if (fallback[i].clipIndex === null && input.clips.length > 0) {
        for (let attempt = 0; attempt < input.clips.length; attempt++) {
          const ci = (rr + attempt) % input.clips.length;
          if (eligibleForShot(input.clips[ci], input.shots[i]?.durationSeconds ?? 0)) {
            fallback[i].clipIndex = ci;
            useCount.set(ci, (useCount.get(ci) ?? 0) + 1);
            rr = ci + 1;
            break;
          }
        }
        if (fallback[i].clipIndex === null) {
          fallback[i].clipIndex = rr % input.clips.length;
          rr += 1;
        }
      }
    }
  };
  assignHeuristic();

  if (provider !== "none" && input.clips.length > 0) {
    const clipList = input.clips
      .map((c, i) => `${i}: "${c.name}" (${c.durationSeconds.toFixed(1)}s) tags=[${c.tags.join(", ")}]`)
      .join("\n");
    const shotList = input.shots
      .map(
        (s) =>
          `shot ${s.index}: beat=${s.beat}, duration=${s.durationSeconds.toFixed(2)}s, hint="${s.sourceHint}"`,
      )
      .join("\n");

    const prompt = `You are editing a ${input.targetDuration}s vertical reel from a library of user clips.
Reel DNA: ${input.analysis.vibe} vibe, ${input.analysis.colorMood} color, captions ${input.analysis.captionStyle.energy} at ${input.analysis.captionStyle.position}.
Hook: ${input.analysis.hook}

LIBRARY CLIPS (use clipIndex from this list, 0-based):
${clipList}

SHOTS TO FILL (in order):
${shotList}

Rules: use MANY different clips — do NOT repeat the same clip on consecutive shots, and rotate through the library. A clip may be slightly shorter than the shot (it will be slowed down).
For EVERY shot, pick the single best library clip and write a short caption (max 6 words, match the caption energy).
Respond with ONLY JSON: { "shots": [ { "index": 0, "clipIndex": 0, "captionText": "..." }, ... ] }
shots array must include every shot index 0..${input.shots.length - 1}.`;

    const raw =
      provider === "openai"
        ? await callOpenAI({ prompt, json: true })
        : await callGemini({ prompt });
    const parsed = parseJson<AiPlanShape>(raw);
    if (parsed?.shots) {
      const byIndex = new Map(
        parsed.shots.filter((s) => typeof s.index === "number").map((s) => [s.index as number, s]),
      );
      const merged = fallback.map((f) => {
        const ai = byIndex.get(f.index);
        if (!ai) return f;
        const shotDur = input.shots[f.index]?.durationSeconds ?? 0;
        const clipIndex =
          typeof ai.clipIndex === "number" &&
          ai.clipIndex >= 0 &&
          ai.clipIndex < input.clips.length &&
          eligibleForShot(input.clips[ai.clipIndex], shotDur)
            ? ai.clipIndex
            : f.clipIndex;
        const captionText =
          typeof ai.captionText === "string" && ai.captionText.trim()
            ? ai.captionText.trim().slice(0, 48)
            : f.captionText;
        return { ...f, clipIndex, captionText };
      });
      enforceVariety(merged, input.shots, input.clips);
      return { planShots: merged, aiUsed: true };
    }
  }

  return { planShots: fallback, aiUsed: false };
}
