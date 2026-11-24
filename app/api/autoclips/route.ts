import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { resolveFfmpeg, resolveYtDlp } from "@/lib/binaries";
import {
  bunnyUrlForFile,
  listLocalFiles,
  storageApiConfigured,
  syncFilesToBunny,
} from "@/lib/bunny";
import { downloadAudioFromUrl, downloadFromUrl, normalizeVideoUrl } from "@/lib/ingest";
import {
  generateClipThumbnail,
  generateStoryboard,
  probeAudioDuration,
  probeMedia,
  renderReel,
} from "@/lib/media";
import { analyzeSongBeats, rankSongResults, searchMusic, suggestMusicQuery } from "@/lib/music";
import { pickFallbackTrack } from "@/lib/fallback_audio";
import { buildReelTexts, renderTextPngs } from "@/lib/reel_text";
import {
  chooseSongForVideo,
  SONG_CATALOG,
  learnedMusicChoice,
  recordMusicChoice,
  type SongMood,
} from "@/lib/song_catalog";
import { analyzeSource, fetchSubtitles, planAutoClips } from "@/lib/autoclip";
import {
  autoClipPath,
  autoDir,
  autoMetaPath,
  autoRoot,
  ensureProjectDirs,
  findSourceFile,
  projectDir,
  readJson,
  writeJson,
} from "@/lib/paths";
import { newId, saveProject } from "@/lib/store";
import type {
  AutoClipJobMeta,
  AutoClipMode,
  AutoClipPlan,
  AutoClipResult,
  ExportFormat,
  MusicSearchResult,
  ProjectMeta,
  ReelLook,
  TimelineJobMeta,
} from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return NextResponse.json(
      { error: "FFmpeg is not installed. Run `brew install ffmpeg` and restart the server." },
      { status: 503 },
    );
  }
  if (!(await resolveYtDlp())) {
    return NextResponse.json(
      { error: "yt-dlp is not installed. Run `brew install yt-dlp` and restart the server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
    targetDuration?: unknown;
    mode?: unknown;
    resolution?: unknown;
    aspect?: unknown;
    look?: unknown;
    faceMode?: unknown;
    editStyle?: unknown;
    shotLength?: unknown;
    textOverlay?: unknown;
    timelineId?: unknown;
    selectedTimes?: unknown;
    focus?: unknown;
    music?: unknown;
  } | null;
  const timelineId = typeof body?.timelineId === "string" ? body.timelineId : null;
  const selectedTimes = Array.isArray(body?.selectedTimes)
    ? body.selectedTimes
        .map(Number)
        .filter((time) => Number.isFinite(time) && time >= 0)
        .slice(0, 20)
    : [];
  const url = normalizeVideoUrl(String(body?.url ?? ""));
  let timeline: TimelineJobMeta | null = null;
  if (timelineId) {
    timeline = await readJson<TimelineJobMeta>(autoMetaPath(timelineId));
    if (!timeline || timeline.status !== "ready" || selectedTimes.length === 0) {
      return NextResponse.json({ error: "Timeline is not ready or no frames were selected." }, { status: 400 });
    }
  }
  if (!url && !timeline) {
    return NextResponse.json({ error: "Paste a valid video link (https://…)." }, { status: 400 });
  }
  const videoUrl = url || timeline?.url || "";
  const rawDuration = Number(body?.targetDuration ?? 30);
  const targetDuration = Number.isFinite(rawDuration)
    ? Math.min(60, Math.max(15, Math.round(rawDuration)))
    : 30;
  const clipCount = 5;
  const mode: AutoClipMode =
    body?.mode === "talking" || body?.mode === "visual" || body?.mode === "both"
      ? body.mode
      : "both";
  const rawResolution = Number(body?.resolution ?? 1080);
  const resolution = rawResolution === 720 ? 720 : 1080;
  const aspect: ExportFormat =
    body?.aspect === "vertical" || body?.aspect === "horizontal" || body?.aspect === "fit"
      ? body.aspect
      : "vertical";
  const requestedLook = body?.look;
  const look: ReelLook =
    requestedLook === "warm" ||
    requestedLook === "clean" ||
    requestedLook === "cinematic" ||
    requestedLook === "none"
      ? requestedLook
      : "warm";
  const faceMode =
    body?.faceMode === "faceless" || body?.faceMode === "any" ? body.faceMode : "main";
  const editStyle = body?.editStyle === "montage" ? "montage" : "clean";
  const rawShotLength = Number(body?.shotLength ?? 3);
  const shotLength =
    rawShotLength === 0 || (rawShotLength >= 1.5 && rawShotLength <= 5)
      ? Math.round(rawShotLength * 10) / 10
      : 3;
  const rawMusic = body?.music as
    | { mode?: unknown; url?: unknown; title?: unknown; query?: unknown; volume?: unknown; mood?: unknown; licenseSafe?: unknown }
    | null
    | undefined;
  const musicMode =
    rawMusic?.mode === "auto" || rawMusic?.mode === "url" || rawMusic?.mode === "catalog"
      ? rawMusic.mode
      : "none";
  const musicUrl = musicMode === "url" ? normalizeVideoUrl(String(rawMusic?.url ?? "")) : null;
  if (musicMode === "url" && !musicUrl) {
    return NextResponse.json({ error: "Paste a valid song URL." }, { status: 400 });
  }
  const rawVolume = Number(rawMusic?.volume ?? 0.9);
  const musicVolume = Number.isFinite(rawVolume) ? Math.min(1, Math.max(0, rawVolume)) : 0.9;
  const musicTitle =
    (musicMode === "url" || musicMode === "catalog") && typeof rawMusic?.title === "string"
      ? rawMusic.title.slice(0, 200)
      : null;
  const musicQuery = typeof rawMusic?.query === "string" ? rawMusic.query.slice(0, 200) : null;
  const licenseSafe = rawMusic?.licenseSafe === true;
  const requestedMood = rawMusic?.mood;
  const musicMood: SongMood | "auto" =
    requestedMood === "cozy" || requestedMood === "trending" || requestedMood === "cinematic"
      ? requestedMood
      : "auto";
  const textOverlay = body?.textOverlay !== false;
  const focus = String(body?.focus ?? "").trim().slice(0, 200);

  const id = randomUUID();
  const jobDir = autoDir(id);
  const sourceId = newId();
  await fs.mkdir(path.join(jobDir, "work"), { recursive: true });
  await ensureProjectDirs(sourceId);

  const meta: AutoClipJobMeta = {
    id,
    status: "downloading",
    progress: 2,
    detail: "Queued…",
    url: videoUrl,
    sourceId,
    targetDuration,
    clipCount,
    mode,
    resolution,
    aspect,
    look,
    faceMode,
    shotLength,
    textOverlay,
    focus,
    music:
      musicMode === "none"
        ? null
        : {
            mode: musicMode,
            title: musicTitle,
            url: musicUrl,
            volume: musicVolume,
            mood: musicMood === "auto" ? null : musicMood,
            licenseSafe,
          },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const metaFile = autoMetaPath(id);
  await writeJson(metaFile, meta);

  const update = async (patch: Partial<AutoClipJobMeta>) => {
    const current = (await readJson<AutoClipJobMeta>(metaFile)) ?? meta;
    await writeJson(metaFile, { ...current, ...patch, updatedAt: new Date().toISOString() });
  };

  void (async () => {
    try {
      let filePath: string;
      let title: string | null = null;
      let cues: Awaited<ReturnType<typeof fetchSubtitles>> = [];
      let probe;
      if (timeline) {
        await update({ status: "analyzing", progress: 18, detail: "Using your selected frames…" });
        const source = await findSourceFile(timeline.sourceId);
        if (!source) throw new Error("The timeline source video is missing.");
        filePath = source.file;
        probe = await probeMedia(filePath);
      } else {
        await update({ status: "downloading", progress: 4, detail: "Downloading the source video…" });
        const subtitlesPromise = fetchSubtitles(videoUrl, jobDir);
        const downloaded = await downloadFromUrl(videoUrl, sourceId, (pct) => {
          void update({
            progress: 4 + Math.round(pct * 0.16),
            detail: `Downloading the source video… ${pct}%`,
          });
        }, resolution);
        filePath = downloaded.filePath;
        title = downloaded.title;
        cues = await subtitlesPromise;
        await update({ title: title ?? null });
        probe = await probeMedia(filePath);
      }
      const sourceMeta: ProjectMeta = {
        id: sourceId,
        originalName: title?.slice(0, 200) || path.basename(filePath),
        createdAt: new Date().toISOString(),
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        thumbCount: 0,
        thumbInterval: 0,
        exports: [],
        sourceUrl: url || timeline?.url,
        ingest: { status: "ready" },
      };
      await saveProject(sourceMeta);

      if (probe.durationSeconds < targetDuration + 2) {
        throw new Error(
          `The source video is only ${probe.durationSeconds.toFixed(1)}s — pick a shorter clip length.`,
        );
      }

      let analysis;
      if (timeline) {
        analysis = {
          durationSeconds: probe.durationSeconds,
          hardCuts: [] as number[],
          activity: [] as Array<{ at: number; score: number }>,
          silences: [] as Array<{ start: number; end: number }>,
          cues,
          hasSubtitles: cues.length >= 3,
          hasAudio: probe.hasAudio,
        };
        await update({
          progress: 34,
          detail: `${selectedTimes.length} frames selected across the video.`,
          analysis: {
            durationSeconds: probe.durationSeconds,
            hasSubtitles: false,
            cueCount: 0,
            hardCuts: 0,
            silenceCount: 0,
          },
        });
      } else {
        await update({ status: "analyzing", progress: 22, detail: "Reading scenes, dialogue and pacing…" });
        analysis = await analyzeSource(filePath, probe.durationSeconds, cues, probe.hasAudio);
        await update({
          progress: 34,
          detail: analysis.hasSubtitles
            ? `Found ${cues.length} dialogue cues and ${analysis.hardCuts.length} visual cuts.`
            : `Mapped ${analysis.hardCuts.length} visual cuts and ${analysis.silences.length} quiet stretches.`,
          analysis: {
            durationSeconds: probe.durationSeconds,
            hasSubtitles: analysis.hasSubtitles,
            cueCount: cues.length,
            hardCuts: analysis.hardCuts.length,
            silenceCount: analysis.silences.length,
          },
        });
      }

      const activityRate = analysis.activity.length / Math.max(1, probe.durationSeconds);
      const videoEnergy = Math.min(1, activityRate / 0.25);
      const catalogSong =
        musicMode === "catalog"
          ? SONG_CATALOG.find(
              (song) =>
                musicTitle?.toLowerCase().includes(song.title.toLowerCase()) ||
                (musicQuery?.toLowerCase().includes(song.title.toLowerCase()) ?? false),
            ) ?? null
          : null;
      const songChoice =
        catalogSong ??
        chooseSongForVideo({
          focus,
          keywords: [],
          energy: videoEnergy,
          mood: musicMood === "auto" ? undefined : musicMood,
        });
      await update({
        status: "planning",
        progress: 42,
        detail: `Song picked: ${songChoice.title} — now choosing matching shots…`,
      });
      const plans: AutoClipPlan[] = timeline
        ? selectedTimes.map((time, index) => {
            const span = Math.min(20, targetDuration);
            const start = Math.max(0, Math.min(probe.durationSeconds - span, time - span / 2));
            const end = Math.min(probe.durationSeconds, start + span);
            const type: "talking" | "visual" =
              mode === "both" ? (index % 2 === 0 ? "talking" : "visual") : mode;
            return {
              index,
              sequence: index + 1,
              type,
              title: `Selected moment ${index + 1}`,
              reason: `Built around your picked frame at ${Math.round(time)}s.`,
              startAt: start,
              endAt: end,
              durationSeconds: end - start,
              ranges: [
                {
                  start: Math.round(start * 10) / 10,
                  end: Math.round(end * 10) / 10,
                  score: 1,
                },
              ],
              keywords: [],
              score: 100,
              aiUsed: false,
              mute: type === "visual",
            };
          })
        : await planAutoClips({
            analysis,
            targetDuration,
            clipCount,
            focus,
            mode,
            shotLength,
            sourceFile: filePath,
            faceMode,
            songArc: songChoice.arc,
            editStyle,
          });
      if (plans.length === 0) throw new Error("Could not find any usable moments in this video.");
      await update({
        progress: 48,
        detail: `${plans.length} highlight reels built from the full video (${mode}).`,
        plans,
      });

      let song: { file: string; title: string; trim?: { start: number; end: number } } | null = null;
      let chosenMood: SongMood | null = null;
      let suggestion: string | null = null;
      if (musicMode !== "none") {
        let songUrl: string | null = musicUrl;
        let chosenCandidate: MusicSearchResult | null = null;
        let usedFallback = false;
        let candidates: MusicSearchResult[] = [];
        const context = `${focus} ${plans.map((p) => p.title).join(" ")}`;
        chosenMood = musicMood === "auto" || musicMode === "catalog" ? songChoice.mood : musicMood;
        if (musicMode === "auto" || musicMode === "catalog") {
          await update({ progress: 50, detail: `Finding ${songChoice.title} for your clips…` });
          const choice = songChoice;
          const rawLearned =
            musicMode === "auto" ? await learnedMusicChoice(focus.trim(), chosenMood) : null;
          const learned =
            rawLearned && rawLearned.title.toLowerCase().includes(choice.title.toLowerCase())
              ? rawLearned
              : null;
          const target = learned
            ? { title: learned.title.split("—")[0].trim(), artist: "" }
            : { title: choice.title, artist: choice.artist };
          suggestion = learned
            ? `${learned.title} · learned from your picks`
            : musicMode === "catalog"
              ? `${choice.title} — ${choice.artist} · picked from the 50-song list`
              : `${choice.title} — ${choice.artist} · ${choice.use}`;
          if (!licenseSafe) {
            const queries =
              musicMode === "catalog"
                ? [musicQuery ?? choice.query, choice.title]
                : learned
                  ? [learned.title, choice.query]
                  : [focus.trim() ? `${choice.query} ${focus.slice(0, 40)}` : choice.query];
            for (const query of queries) {
              candidates.push(...rankSongResults(await searchMusic(query), target));
              if (candidates.length >= 4) break;
            }
            if (candidates.length === 0) {
              const fallbackQuery = await suggestMusicQuery(focus, plans.map((p) => p.title));
              candidates = rankSongResults(await searchMusic(fallbackQuery), target);
            }
            candidates = candidates
              .filter((item, i, all) => all.findIndex((other) => other.url === item.url) === i)
              .slice(0, 5);
          }
        } else if (musicUrl) {
          candidates = [
            {
              id: "manual",
              url: musicUrl,
              title: musicTitle || "Your song",
              duration: null,
              channel: null,
            },
          ];
        }
        if (candidates.length === 0) {
          suggestion = suggestion ?? "No song found — add audio inside Instagram";
          await update({
            detail: "No song available — attach the suggested audio in Instagram.",
            music: {
              mode: musicMode,
              title: null,
              url: null,
              volume: musicVolume,
              mood: chosenMood,
              suggestion,
            },
          });
        }
        for (const candidate of candidates) {
          try {
            await update({ progress: 52, detail: `Downloading ${candidate.title}…` });
            const downloaded = await downloadAudioFromUrl(candidate.url, sourceId);
            const duration = await probeAudioDuration(downloaded.filePath);
            if (duration < 8) throw new Error("audio too short");
            const start =
              duration > targetDuration + 1 ? Math.min(duration - targetDuration, duration * 0.25) : 0;
            song = {
              file: downloaded.filePath,
              title: candidate.title,
              trim:
                duration > targetDuration + 1
                  ? {
                      start: Math.round(start * 10) / 10,
                      end: Math.round((start + targetDuration) * 10) / 10,
                    }
                  : undefined,
            };
            songUrl = candidate.url;
            chosenCandidate = candidate;
            await recordMusicChoice(focus.trim(), chosenMood, candidate.title, candidate.url);
            break;
          } catch {
            song = null;
          }
        }
        const looksOfficial = chosenCandidate
          ? /official|vevo|topic|\baudio\b/i.test(chosenCandidate.title)
          : false;
        const licenseRisk = Boolean(song && !usedFallback && !looksOfficial);
        if (!song && musicMode === "auto") {
          await update({
            progress: 52,
            detail: licenseSafe
              ? "Using built-in audio — attach the suggested sound in Instagram."
              : "YouTube is blocked — using built-in music…",
          });
          const fallback = await pickFallbackTrack(chosenMood ?? "cozy", context);
          if (fallback) {
            song = {
              file: fallback.file,
              title: fallback.title,
              trim: { start: 2, end: Math.min(39, 2 + targetDuration) },
            };
            songUrl = null;
            usedFallback = true;
            suggestion = suggestion ?? fallback.title;
          }
        }
        await update({
          music: {
            mode: musicMode,
            title: song?.title ?? null,
            url: songUrl,
            volume: musicVolume,
            mood: chosenMood,
            suggestion,
            fallback: usedFallback,
            licenseRisk,
            licenseSafe,
          },
        });
      }

      if (song) {
        const beats = await analyzeSongBeats(song.file);
        if (beats?.interval && beats.interval >= 0.25 && beats.interval <= 1.2 && song.trim) {
          const interval = beats.interval;
          const phase = beats.phase || 0;
          const aligned = phase + Math.round((song.trim.start - phase) / interval) * interval;
          song.trim.start = Math.max(0, Math.round(aligned * 10) / 10);
          song.trim.end = Math.round((song.trim.start + targetDuration) * 10) / 10;
          for (const plan of plans) {
            plan.ranges = plan.ranges.map((range) => {
              const duration = Math.max(0.5, range.end - range.start);
              const snapped = Math.max(1, Math.round(duration / interval)) * interval;
              return { ...range, end: Math.round((range.start + snapped) * 10) / 10 };
            });
            plan.durationSeconds = plan.ranges.reduce((n, r) => n + r.end - r.start, 0);
          }
          await update({ detail: `Beats locked at ${beats.bpm ?? Math.round(60 / interval)} BPM.` });
        }
      }

      await update({ status: "rendering", progress: 54, detail: "Cutting your clips…" });
      const canvasWidth =
        aspect === "horizontal"
          ? Math.max(2, Math.round((resolution * 16) / 9 / 2) * 2)
          : Math.max(2, Math.round((resolution * 9) / 16 / 2) * 2);
      const results: AutoClipResult[] = [];
      for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const fileName = `clip-${i + 1}.mp4`;
        const thumbnail = `clip-${i + 1}.jpg`;
        const workDir = path.join(jobDir, "work", `clip-${i + 1}`);
        await fs.mkdir(workDir, { recursive: true });
        const texts = textOverlay
          ? buildReelTexts({
              ranges: plan.ranges,
              hook: (
                plan.hook ??
                (editStyle === "clean" ? plan.title : focus ? `POV: ${focus}` : plan.title)
              )
                .trim()
                .slice(0, 60),
              index: i,
              sourceDuration: analysis.durationSeconds,
            })
          : [];
        await renderTextPngs(texts, workDir, canvasWidth, resolution);
        await update({
          progress: 54 + Math.round(((i + 1) / plans.length) * 43),
          detail: `Editing clip ${i + 1}/${plans.length}: ${plan.title}`,
        });
        await renderReel({
          sourceFile: filePath,
          ranges: plan.ranges,
          crop: "center",
          format: aspect,
          outputFile: autoClipPath(id, fileName),
          workDir,
          videoHasAudio: probe.hasAudio,
          height: resolution,
          look,
          mute: song ? false : plan.mute,
          textOverlays: texts,
          punchIndices:
            editStyle === "clean"
              ? []
              : plan.ranges
                  .map((_, idx) => idx)
                  .filter((idx) => idx >= 2 && idx % 4 === 2),
          fadeOut: true,
          ...(song
            ? {
                music: {
                  fileName: path.basename(song.file),
                  volume: musicVolume,
                  mode: "replace" as const,
                  trim: song.trim,
                  file: song.file,
                },
              }
            : {}),
        });
        await generateClipThumbnail(filePath, autoClipPath(id, thumbnail), plan.ranges[0]?.start ?? 0);
        const storyboard = `clip-${i + 1}-board.jpg`;
        await generateStoryboard(
          autoClipPath(id, fileName),
          autoClipPath(id, storyboard),
          plan.durationSeconds,
        );
        results.push({
          index: i,
          sequence: plan.sequence,
          type: plan.type,
          fileName,
          thumbnail,
          storyboard,
          title: plan.title,
          reason: plan.reason,
          durationSeconds: plan.durationSeconds,
          rangeCount: plan.ranges.length,
          startAt: plan.startAt,
        });
      }

      await update({ status: "ready", progress: 100, detail: "Ready!", clips: results });
      if (storageApiConfigured()) {
        void (async () => {
          const jobFiles = [
            ...(await listLocalFiles(autoDir(id))),
            ...(await listLocalFiles(projectDir(sourceId))),
          ];
          const sync = await syncFilesToBunny(jobFiles);
          const fresh = await readJson<AutoClipJobMeta>(metaFile);
          if (!fresh?.clips) return;
          await update({
            clips: fresh.clips.map((clip) => ({
              ...clip,
              cdnUrl: bunnyUrlForFile(autoClipPath(id, clip.fileName)) || undefined,
            })),
            storage: { synced: sync.failed === 0, count: sync.uploaded },
          });
        })();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auto clip generation failed.";
      await update({ status: "error", error: message, detail: message });
    }
  })();

  return NextResponse.json({ job: meta }, { status: 201 });
}

export async function GET() {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(autoRoot());
  } catch {
    return NextResponse.json({ jobs: [] });
  }
  const jobs: AutoClipJobMeta[] = [];
  for (const entry of entries) {
    const meta = await readJson<AutoClipJobMeta>(autoMetaPath(entry));
    if (meta) jobs.push(meta);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ jobs: jobs.slice(0, 12) });
}
