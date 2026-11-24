export type CropPosition = "left" | "center" | "right";

export type IngestStatus = "downloading" | "processing" | "ready" | "error";

export type IngestState = {
  status: IngestStatus;
  progress?: number;
  error?: string | null;
  detail?: string | null;
};

export type ClipRange = {
  start: number;
  end: number;
};

export type ExportJobStatus = "queued" | "rendering" | "done" | "error";

export type ExportFormat = "vertical" | "horizontal" | "fit";

export const EXPORT_FORMATS: ExportFormat[] = ["vertical", "horizontal", "fit"];

export type ReelLook = "warm" | "clean" | "cinematic" | "none";

export const REEL_LOOKS: ReelLook[] = ["warm", "clean", "cinematic", "none"];

export type MusicMode = "mix" | "replace";

export type LyricLine = { t: number; text: string };

export type MusicSearchResult = {
  id: string;
  url: string;
  title: string;
  duration: number | null;
  channel: string | null;
};

export type MusicTrim = { start: number; end: number };

export type ProjectMusic = {
  status: "downloading" | "processing" | "ready" | "error";
  progress?: number;
  fileName?: string;
  title?: string | null;
  durationSeconds?: number;
  sourceUrl?: string;
  error?: string | null;
  lyrics?: { source: string; lines: LyricLine[] };
};

export type JobMusic = {
  fileName: string;
  volume: number;
  mode: MusicMode;
  trim?: MusicTrim;
};

export type ExportJob = {
  id: string;
  status: ExportJobStatus;
  createdAt: string;
  updatedAt: string;
  ranges: ClipRange[];
  crop: CropPosition;
  format?: ExportFormat;
  music?: JobMusic | null;
  outputFile: string | null;
  error: string | null;
};

export type VideoSegment = {
  name: string;
  sourceType: "file" | "link";
  sourceUrl?: string;
  start: number;
  end: number;
  durationSeconds: number;
};

export type ProjectMeta = {
  id: string;
  originalName: string;
  createdAt: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  thumbCount: number;
  thumbInterval: number;
  exports: ExportJob[];
  sourceUrl?: string;
  ingest?: IngestState;
  music?: ProjectMusic;
  segments?: VideoSegment[];
};

export type LibraryClip = {
  id: string;
  name: string;
  fileName: string;
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  createdAt: string;
  tags: string[];
  meanColor?: { r: number; g: number; b: number } | null;
};

export type RecreateBeat = "hook" | "setup" | "build" | "payoff" | "cta";

export type ReelAnalysis = {
  durationSeconds: number;
  sceneCuts: number[];
  hook: string;
  vibe: string;
  colorMood: string;
  captionStyle: { position: "top" | "center" | "bottom"; energy: "punchy" | "chill" | "hype" };
  structureBeats: RecreateBeat[];
  shotHints: string[];
  pacing: { cutsPer10s: number; avgShotSeconds: number };
  hasVoice: boolean;
  aiUsed: boolean;
};

export type ShotClipAssignment = {
  libraryClipId: string;
  clipName: string;
  sourceStart: number;
  sourceEnd: number;
};

export type ShotPlan = {
  index: number;
  beat: RecreateBeat;
  durationSeconds: number;
  startAt: number;
  captionText: string;
  clip: ShotClipAssignment | null;
  sourceHint: string;
};

export type EditPlan = {
  targetDuration: number;
  shots: ShotPlan[];
  captionPosition: "top" | "center" | "bottom";
  captionEnergy: "punchy" | "chill" | "hype";
  aiUsed: boolean;
};

export type AutoClipType = "talking" | "visual";

export type AutoClipMode = AutoClipType | "both";

export type AutoClipStatus =
  | "downloading"
  | "analyzing"
  | "planning"
  | "rendering"
  | "ready"
  | "error";

export type SubtitleCue = { start: number; end: number; text: string };

export type Silence = { start: number; end: number };

export type SceneEvent = { at: number; score: number };

export type AutoClipRange = ClipRange & { score: number };

export type AutoClipPlan = {
  index: number;
  sequence: number;
  type: AutoClipType;
  title: string;
  hook?: string;
  reason: string;
  startAt: number;
  endAt: number;
  durationSeconds: number;
  ranges: AutoClipRange[];
  keywords: string[];
  score: number;
  aiUsed: boolean;
  mute: boolean;
};

export type AutoClipSourceAnalysis = {
  durationSeconds: number;
  hardCuts: number[];
  activity: SceneEvent[];
  silences: Silence[];
  cues: SubtitleCue[];
  hasSubtitles: boolean;
  hasAudio: boolean;
};

export type AutoClipResult = {
  index: number;
  sequence: number;
  type: AutoClipType;
  fileName: string;
  thumbnail: string;
  storyboard?: string;
  cdnUrl?: string;
  title: string;
  reason: string;
  durationSeconds: number;
  rangeCount: number;
  startAt: number;
};

export type TimelineFrame = {
  index: number;
  time: number;
  file: string;
};

export type TimelineJobMeta = {
  id: string;
  status: "downloading" | "generating" | "ready" | "error";
  progress: number;
  detail: string;
  error?: string | null;
  url: string;
  sourceId: string;
  durationSeconds?: number;
  interval?: number;
  frames?: TimelineFrame[];
  createdAt: string;
  updatedAt: string;
};

export type AutoClipJobMeta = {
  id: string;
  status: AutoClipStatus;
  progress: number;
  detail: string;
  error?: string | null;
  url: string;
  title?: string | null;
  sourceId: string;
  targetDuration: number;
  clipCount: number;
  mode: AutoClipMode;
  resolution: number;
  aspect?: ExportFormat;
  shotLength?: number;
  look?: ReelLook;
  faceMode?: "main" | "faceless" | "any";
  textOverlay?: boolean;
  focus?: string;
  music?: {
    mode: "auto" | "url" | "catalog";
    title?: string | null;
    url?: string | null;
    volume: number;
    mood?: string | null;
    suggestion?: string | null;
    fallback?: boolean;
    licenseRisk?: boolean;
    licenseSafe?: boolean;
  } | null;
  analysis?: {
    durationSeconds: number;
    hasSubtitles: boolean;
    cueCount: number;
    hardCuts: number;
    silenceCount: number;
  } | null;
  plans?: AutoClipPlan[] | null;
  clips?: AutoClipResult[] | null;
  storage?: { synced?: boolean; count?: number } | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerateStyle = "cinematic-warm" | "documentary" | "modern-minimal";

export const GENERATE_STYLES: GenerateStyle[] = ["cinematic-warm", "documentary", "modern-minimal"];

export type GeneratedShot = {
  index: number;
  startAt: number;
  durationSeconds: number;
  visual: string;
  narration: string;
  caption: string;
};

export type GenerateShotlist = {
  title: string;
  style: GenerateStyle;
  targetDuration: number;
  shots: GeneratedShot[];
  aiUsed: boolean;
};

export type GenerateStatus = "planning" | "rendering" | "ready" | "error";

export type GenerateJobMeta = {
  id: string;
  status: GenerateStatus;
  progress: number;
  detail: string;
  error?: string | null;
  prompt: string;
  style: GenerateStyle;
  targetDuration: number;
  includeNarration: boolean;
  includeAmbient: boolean;
  includeCaptions: boolean;
  shotlist?: GenerateShotlist | null;
  result?: {
    fileName: string;
    durationSeconds: number;
    shotsCount: number;
    narrationUsed: boolean;
    narrationNote?: string | null;
    captionsBurned: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type RecreateStatus =
  | "downloading"
  | "analyzing"
  | "planning"
  | "rendering"
  | "ready"
  | "error";

export type RecreateJobMeta = {
  id: string;
  status: RecreateStatus;
  progress: number;
  detail: string;
  error?: string | null;
  referenceUrl: string;
  referenceTitle?: string | null;
  targetDuration: number;
  libraryClipIds: string[];
  /** Caption burn + SRT sidecar requested (default true; absent = true for old jobs). */
  includeCaptions?: boolean;
  analysis?: ReelAnalysis | null;
  plan?: EditPlan | null;
  result?: {
    fileName: string;
    durationSeconds: number;
    shotsCount: number;
    clipsUsed: string[];
    captionsBurned?: boolean;
    captionWarning?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

