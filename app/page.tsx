"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LibrarySection from "@/components/LibrarySection";
import RecreateSection from "@/components/RecreateSection";
import type {
  ClipRange,
  CropPosition,
  ExportFormat,
  ExportJob,
  LibraryClip,
  LyricLine,
  MusicMode,
  MusicSearchResult,
  ProjectMeta,
} from "@/lib/types";

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function fmtShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type StagedItem = {
  id: string;
  type: "file" | "link";
  name: string;
  file?: File;
  size?: number;
  url?: string;
  domain?: string;
  selected: boolean;
};

function fmtSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isVideoFileName(name: string): boolean {
  return /\.(mp4|mov|m4v|webm|mkv)$/i.test(name);
}

function parseTime(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  const m = trimmed.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  return null;
}

type RangeRow = ClipRange & { key: string };

let keyCounter = 0;
function makeRow(start: number, end: number): RangeRow {
  keyCounter += 1;
  return { key: `r${keyCounter}`, start, end };
}

function defaultRanges(d: number): RangeRow[] {
  return [
    makeRow(Math.min(1, Math.max(0, d - 4)), Math.min(5, d)),
    makeRow(Math.max(0, d / 2 - 2), Math.min(d, d / 2 + 2)),
    makeRow(Math.max(0, d - 4), d),
  ].filter((r) => r.end - r.start >= 0.3);
}

function draftKey(id: string): string {
  return `framemuse:draft:${id}`;
}

type Draft = {
  ranges: { start: number; end: number }[];
  crop: CropPosition;
  format: ExportFormat;
  musicVolume: number;
  musicMode: MusicMode;
  includeMusic: boolean;
  musicPart: { start: number; end: number } | null;
};

function loadDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (!d || !Array.isArray(d.ranges)) return null;
    return {
      ranges: d.ranges,
      crop: d.crop === "left" || d.crop === "right" ? d.crop : "center",
      format: d.format === "horizontal" || d.format === "fit" ? d.format : "vertical",
      musicVolume:
        typeof d.musicVolume === "number" && d.musicVolume >= 0 && d.musicVolume <= 1
          ? d.musicVolume
          : 0.6,
      musicMode: d.musicMode === "replace" ? "replace" : "mix",
      includeMusic: d.includeMusic !== false,
      musicPart:
        d.musicPart &&
        typeof d.musicPart.start === "number" &&
        typeof d.musicPart.end === "number" &&
        Number.isFinite(d.musicPart.start) &&
        Number.isFinite(d.musicPart.end) &&
        d.musicPart.end - d.musicPart.start >= 1
          ? d.musicPart
          : null,
    };
  } catch {
    return null;
  }
}

function sanitizeDraftRanges(
  raw: { start: number; end: number }[],
  duration: number,
): RangeRow[] {
  const rows: RangeRow[] = [];
  for (const r of raw) {
    const s = Number(r?.start);
    const e = Number(r?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const start = Math.max(0, Math.min(s, duration));
    const end = Math.max(0, Math.min(e, duration));
    if (end - start >= 0.3) rows.push(makeRow(start, end));
  }
  return rows;
}

// Retries so a transient failure on load doesn't leave the library looking empty.
function fetchLibraryClips(attempt: number): Promise<LibraryClip[]> {
  return fetch("/api/library")
    .then((r) => {
      if (!r.ok) throw new Error(`library ${r.status}`);
      return r.json() as Promise<{ clips?: LibraryClip[] }>;
    })
    .then((data) => data.clips ?? [])
    .catch((err) => {
      if (attempt >= 2) throw err;
      return new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1))).then(() =>
        fetchLibraryClips(attempt + 1),
      );
    });
}

export default function StudioPage() {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<{ ffmpeg: boolean; ytDlp: boolean } | null>(null);
  const [ranges, setRanges] = useState<RangeRow[]>([]);
  const [checkedRows, setCheckedRows] = useState<ReadonlySet<string>>(new Set());
  const [crop, setCrop] = useState<CropPosition>("center");
  const [format, setFormat] = useState<ExportFormat>("vertical");
  const [exporting, setExporting] = useState(false);
  const [selectedExport, setSelectedExport] = useState<ExportJob | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const [importMode, setImportMode] = useState<"combine" | "separate">("combine");
  const [activeMediaTab, setActiveMediaTab] = useState<"clips" | "links">("clips");
  const [linkInputText, setLinkInputText] = useState("");
  const [importProgressText, setImportProgressText] = useState<string | null>(null);
  const [importOverallPct, setImportOverallPct] = useState(0);
  const [musicUrl, setMusicUrl] = useState("");
  const [musicImporting, setMusicImporting] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.6);
  const [musicMode, setMusicMode] = useState<MusicMode>("mix");
  const [includeMusic, setIncludeMusic] = useState(true);
  const [searchResults, setSearchResults] = useState<MusicSearchResult[]>([]);
  const [searchFor, setSearchFor] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [musicPart, setMusicPart] = useState<{ start: number; end: number } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [recent, setRecent] = useState<ProjectMeta[] | null>(null);
  const [bulkMore, setBulkMore] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [homeView, setHomeView] = useState<"studio" | "library" | "recreate">("studio");
  const [libraryClips, setLibraryClips] = useState<LibraryClip[]>([]);
  const [librarySelected, setLibrarySelected] = useState<ReadonlySet<string>>(new Set());
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ anchor: number; startX: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const seededForRef = useRef<string | null>(null);
  const lyricsForRef = useRef<string | null>(null);
  const lyricAnchorRef = useRef<number | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  const lastSavedForRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setTools({ ffmpeg: Boolean(d.ffmpeg), ytDlp: Boolean(d.ytDlp) }))
      .catch(() => setTools({ ffmpeg: false, ytDlp: false }));
  }, []);

  const wantsLibrary = homeView === "library" || homeView === "recreate";
  const libSelSeededRef = useRef(false);

  // Remember the last open tab so a refresh lands you back where you were
  // (otherwise your library "disappears" until you click the tab again).
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const saved = sessionStorage.getItem("fm:view");
        if (saved === "library" || saved === "recreate") setHomeView(saved);
      } catch {
        /* storage unavailable */
      }
    });
  }, []);

  const setView = (v: "studio" | "library" | "recreate") => {
    setHomeView(v);
    try {
      sessionStorage.setItem("fm:view", v);
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    if (libraryLoaded && !wantsLibrary) return;
    let cancelled = false;
    fetchLibraryClips(0)
      .then((clips) => {
        if (cancelled) return;
        setLibraryClips(clips);
        setLibraryLoaded(true);
        setLibrarySelected((prev) => {
          if (!libSelSeededRef.current) {
            libSelSeededRef.current = true;
            return new Set(clips.map((c) => c.id));
          }
          const ids = new Set(clips.map((c) => c.id));
          const next = new Set<string>();
          for (const id of prev) if (ids.has(id)) next.add(id);
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setLibraryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsLibrary, libraryLoaded]);

  // Seed default ranges once a project is ready (upload or link import),
  // or restore the saved draft if this project was being edited before a refresh.
  useEffect(() => {
    if (!project) {
      seededForRef.current = null;
      return;
    }
    if (project.ingest && project.ingest.status !== "ready") return;
    if (seededForRef.current === project.id || project.durationSeconds <= 0) return;
    seededForRef.current = project.id;
    const d = project.durationSeconds;
    const draft = loadDraft(project.id);
    const rows = draft ? sanitizeDraftRanges(draft.ranges, d) : [];
    setPlayhead(0);
    setSel(null);
    setRanges(rows.length > 0 ? rows : defaultRanges(d));
    setCrop(draft?.crop ?? "center");
    setFormat(draft?.format ?? "vertical");
    setMusicVolume(draft?.musicVolume ?? 0.6);
    setMusicMode(draft?.musicMode ?? "mix");
    setIncludeMusic(draft?.includeMusic ?? true);
    setMusicPart(draft?.musicPart ?? null);
    lyricAnchorRef.current = null;
  }, [project]);

  // Save the in-progress edit so an auto-refresh never loses clips or settings.
  useEffect(() => {
    if (!project || seededForRef.current !== project.id) return;
    if (project.ingest && project.ingest.status !== "ready") return;
    // First pass after the seed: wait for the seeded state to land before writing.
    if (lastSavedForRef.current !== project.id) {
      lastSavedForRef.current = project.id;
      return;
    }
    try {
      localStorage.setItem(
        draftKey(project.id),
        JSON.stringify({
          ranges: ranges.map(({ start, end }) => ({ start, end })),
          crop,
          format,
          musicVolume,
          musicMode,
          includeMusic,
          musicPart,
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [project, ranges, crop, format, musicVolume, musicMode, includeMusic, musicPart]);

  // Recent projects shown on the home screen (pick one to reopen with its saved draft).
  useEffect(() => {
    if (project) return;
    let alive = true;
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { projects?: ProjectMeta[] }) => {
        if (alive) setRecent(Array.isArray(d.projects) ? d.projects.slice(0, 12) : []);
      })
      .catch(() => {
        if (alive) setRecent([]);
      });
    return () => {
      alive = false;
    };
  }, [project]);

  // Poll while an export job or link import is in flight.
  useEffect(() => {
    if (!project) return;
    const ingestActive =
      project.ingest?.status === "downloading" || project.ingest?.status === "processing";
    const exportActive = project.exports.some(
      (e) => e.status === "queued" || e.status === "rendering",
    );
    const musicActive =
      project.music?.status === "downloading" || project.music?.status === "processing";
    if (!ingestActive && !exportActive && !musicActive) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { project: ProjectMeta };
      setProject(data.project);
      setSelectedExport((prev) => {
        if (!prev) return prev;
        return data.project.exports.find((e) => e.id === prev.id) ?? prev;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [project]);

  // Debounced song search as the user types (skips when it looks like a URL).
  useEffect(() => {
    const q = musicUrl.trim();
    if (q.length < 2 || /^https?:\/\//i.test(q)) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setSearchLoading(true);
      fetch(`/api/music/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: { results?: MusicSearchResult[] }) => {
          if (ctrl.signal.aborted) return;
          setSearchResults(Array.isArray(d.results) ? d.results : []);
          setSearchFor(q);
          setSearchOpen(true);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSearchResults([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearchLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [musicUrl]);

  // Fetch synced lyrics once per imported track (server caches them too).
  useEffect(() => {
    const m = project?.music;
    if (!project || m?.status !== "ready" || !m.fileName) {
      if (lyricsForRef.current !== null) {
        lyricsForRef.current = null;
        setLyrics(null);
        setMusicPart(null);
        lyricAnchorRef.current = null;
        setLyricsLoading(false);
      }
      return;
    }
    if (lyricsForRef.current === `${project.id}:${m.fileName}`) return;
    const trackChanged = lyricsForRef.current !== null;
    lyricsForRef.current = `${project.id}:${m.fileName}`;
    if (trackChanged) {
      setMusicPart(null);
      lyricAnchorRef.current = null;
    }
    setLyrics(null);
    setLyricsLoading(true);
    fetch(`/api/projects/${project.id}/music/lyrics`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { lines?: LyricLine[] }) => {
        setLyrics(Array.isArray(d.lines) ? d.lines : []);
      })
      .catch(() => setLyrics([]))
      .finally(() => setLyricsLoading(false));
  }, [project]);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setUploading(true);
    setUploadPct(0);
    setSelectedExport(null);
    setRanges([]);
    try {
      const xhr = new XMLHttpRequest();
      const result = await new Promise<{ project: ProjectMeta }>((resolve, reject) => {
        xhr.open("POST", "/api/projects");
        xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            /* ignore */
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(body as { project: ProjectMeta });
          } else {
            const msg = (body as { error?: string } | null)?.error ?? `Upload failed (${xhr.status}).`;
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(file);
      });
      setProject(result.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }, []);

  // Video links pasted into the import box (space/newline/comma separated = several links).
  const linkUrls = Array.from(
    new Set(linkUrl.trim().split(/[\s,]+/).filter((t) => /^https?:\/\/\S+$/i.test(t))),
  );

  const importFromLink = useCallback(async () => {
    setError(null);
    const tokens = Array.from(
      new Set((linkUrl ?? "").trim().split(/[\s,]+/).filter((t) => /^https?:\/\/\S+$/i.test(t))),
    );
    if (tokens.length === 0) {
      setError("Paste a video link (https://…) — or several separated by spaces.");
      return;
    }
    const MAX_LINKS = 8;
    const queue = tokens.slice(0, MAX_LINKS);
    setImporting(true);
    setSelectedExport(null);
    try {
      const results = await Promise.allSettled(
        queue.map(async (url) => {
          const res = await fetch("/api/projects/from-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = (await res.json()) as { project?: ProjectMeta; error?: string };
          if (!res.ok || !data.project) throw new Error(data.error ?? "Import failed.");
          return data.project;
        }),
      );
      const ok: ProjectMeta[] = [];
      const failures: string[] = [];
      results.forEach((r) => {
        if (r.status === "fulfilled") ok.push(r.value);
        else failures.push(r.reason instanceof Error ? r.reason.message : "failed");
      });
      if (ok.length === 0) throw new Error(failures[0] ?? "Import failed.");
      setBulkMore(ok.length - 1);
      setProject(ok[0]);
      setLinkUrl("");
      const notes: string[] = [];
      if (tokens.length > MAX_LINKS) {
        notes.push(`Importing the first ${MAX_LINKS} of ${tokens.length} links.`);
      }
      if (failures.length > 0) notes.push(`${failures.length} link(s) could not start.`);
      if (notes.length > 0) setError(notes.join(" "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }, [linkUrl]);

  const importMusic = useCallback(
    async (urlArg?: string) => {
      if (!project) return;
      const typed = (urlArg ?? musicUrl).trim();
      const isUrl = /^https?:\/\//i.test(typed);
      const target = isUrl
        ? typed
        : searchFor === typed
          ? searchResults[0]?.url
          : undefined;
      if (!target) {
        setError(
          isUrl
            ? "That link doesn't look valid."
            : "Pick a song from the suggestions, or paste a music link.",
        );
        return;
      }
      setError(null);
      setMusicImporting(true);
      setSearchOpen(false);
      try {
        const res = await fetch(`/api/projects/${project.id}/music`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target }),
        });
        const data = (await res.json()) as { music?: ProjectMeta["music"]; error?: string };
        if (!res.ok || !data.music) throw new Error(data.error ?? "Music import failed.");
        setProject((prev) => (prev ? { ...prev, music: data.music } : prev));
        setMusicUrl("");
        setSearchResults([]);
        setIncludeMusic(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Music import failed.");
      } finally {
        setMusicImporting(false);
      }
    },
    [project, musicUrl, searchResults, searchFor],
  );

  const removeMusic = async () => {
    if (!project) return;
    setError(null);
    const res = await fetch(`/api/projects/${project.id}/music`, { method: "DELETE" });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setError(data?.error ?? "Could not remove the track.");
      return;
    }
    audioPreviewRef.current?.pause();
    setPreviewPlaying(false);
    setMusicPart(null);
    lyricAnchorRef.current = null;
    setProject((prev) => (prev ? { ...prev, music: undefined } : prev));
  };

  const onPickClips = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const valid: StagedItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (isVideoFileName(f.name)) {
        valid.push({
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          type: "file",
          name: f.name,
          file: f,
          size: f.size,
          selected: true,
        });
      }
    }
    if (valid.length > 0) {
      setStagedItems((prev) => [...prev, ...valid]);
      setError(null);
    } else {
      setError("Please drop or select valid video files (MP4, MOV, M4V, WEBM, MKV).");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addLinksFromText = (text: string) => {
    const rawTokens = text.trim().split(/[\s,]+/);
    const urls = Array.from(new Set(rawTokens.filter((t) => /^https?:\/\/\S+$/i.test(t))));
    if (urls.length === 0) {
      setError("Please enter or paste a valid video URL (e.g. https://youtube.com/watch?v=...)");
      return;
    }
    const newLinks: StagedItem[] = urls.map((url, i) => {
      let domain = "web";
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {}
      return {
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        type: "link",
        name: `${domain} video`,
        url,
        domain,
        selected: true,
      };
    });
    setStagedItems((prev) => [...prev, ...newLinks]);
    setLinkInputText("");
    setError(null);
  };

  const toggleStagedItem = (id: string) => {
    setStagedItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );
  };

  const removeStagedItem = (id: string) => {
    setStagedItems((prev) => prev.filter((item) => item.id !== id));
  };

  const selectAllStaged = () => {
    setStagedItems((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const deselectAllStaged = () => {
    setStagedItems((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const clearAllStaged = () => {
    setStagedItems([]);
  };

  const uploadPart = async (
    projectId: string,
    file: File,
    index: number,
    onProg: (pct: number) => void,
  ): Promise<{ fileName: string }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/parts`);
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      xhr.setRequestHeader("x-part-index", String(index));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProg(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as { fileName: string });
        } else {
          const msg = (body as { error?: string } | null)?.error ?? `Part upload failed (${xhr.status}).`;
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during part upload."));
      xhr.send(file);
    });
  };

  const uploadFileReturn = async (file: File): Promise<ProjectMeta> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/projects");
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve((body as { project: ProjectMeta }).project);
        } else {
          const msg = (body as { error?: string } | null)?.error ?? `Upload failed (${xhr.status}).`;
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(file);
    });
  };

  const startImportStaged = async () => {
    const selected = stagedItems.filter((i) => i.selected);
    if (selected.length === 0) {
      setError("Please select at least one clip or link to import.");
      return;
    }
    setError(null);
    setImporting(true);
    setSelectedExport(null);
    setRanges([]);

    try {
      if (importMode === "combine" && selected.length > 1) {
        setImportProgressText("Initializing multi-clip project…");
        setImportOverallPct(5);

        const resInit = await fetch("/api/projects/combine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Reel (${selected.length} clips & links)`,
            itemCount: selected.length,
          }),
        });
        const dataInit = (await resInit.json()) as { project?: ProjectMeta; error?: string };
        if (!resInit.ok || !dataInit.project) {
          throw new Error(dataInit.error ?? "Failed to initialize multi-clip project.");
        }

        const combinedProject = dataInit.project;
        setProject(combinedProject);

        const partsPayload: Array<{
          index: number;
          type: "file" | "link";
          name: string;
          fileName?: string;
          url?: string;
        }> = [];

        for (let idx = 0; idx < selected.length; idx++) {
          const item = selected[idx];
          if (item.type === "file" && item.file) {
            setImportProgressText(`Uploading clip ${idx + 1} of ${selected.length} (${item.name})…`);
            const uploaded = await uploadPart(combinedProject.id, item.file, idx, (pct) => {
              const basePct = 10 + Math.round((idx / selected.length) * 40);
              const partPct = Math.round((pct / 100) * (40 / selected.length));
              setImportOverallPct(basePct + partPct);
            });
            partsPayload.push({
              index: idx,
              type: "file",
              name: item.name,
              fileName: uploaded.fileName,
            });
          } else if (item.type === "link" && item.url) {
            partsPayload.push({
              index: idx,
              type: "link",
              name: item.name,
              url: item.url,
            });
          }
        }

        setImportProgressText("Processing clips, downloading links & stitching master video…");
        setImportOverallPct(55);

        const resCombine = await fetch(`/api/projects/${combinedProject.id}/combine-parts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parts: partsPayload }),
        });
        if (!resCombine.ok) {
          const dataErr = (await resCombine.json().catch(() => null)) as { error?: string } | null;
          throw new Error(dataErr?.error ?? "Failed to combine clips.");
        }

        setStagedItems([]);
      } else if (selected.length === 1) {
        const single = selected[0];
        if (single.type === "file" && single.file) {
          await uploadFile(single.file);
        } else if (single.type === "link" && single.url) {
          const res = await fetch("/api/projects/from-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: single.url }),
          });
          const data = (await res.json()) as { project?: ProjectMeta; error?: string };
          if (!res.ok || !data.project) throw new Error(data.error ?? "Import failed.");
          setProject(data.project);
        }
        setStagedItems([]);
      } else {
        // Separate projects mode
        const ok: ProjectMeta[] = [];
        const failures: string[] = [];
        for (let i = 0; i < selected.length; i++) {
          const item = selected[i];
          setImportProgressText(`Importing ${item.name} (${i + 1}/${selected.length})…`);
          setImportOverallPct(Math.round((i / selected.length) * 100));
          try {
            if (item.type === "file" && item.file) {
              const p = await uploadFileReturn(item.file);
              ok.push(p);
            } else if (item.type === "link" && item.url) {
              const res = await fetch("/api/projects/from-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: item.url }),
              });
              const data = (await res.json()) as { project?: ProjectMeta; error?: string };
              if (!res.ok || !data.project) throw new Error(data.error ?? "Link import failed");
              ok.push(data.project);
            }
          } catch (e) {
            failures.push(e instanceof Error ? e.message : "Failed");
          }
        }
        if (ok.length === 0) throw new Error(failures[0] ?? "Import failed.");
        setBulkMore(ok.length - 1);
        setProject(ok[0]);
        setStagedItems([]);
        if (failures.length > 0) {
          setError(`${failures.length} items could not be imported.`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
      setImportProgressText(null);
      setImportOverallPct(0);
    }
  };

  const onPickFiles = (files: FileList | null) => {
    onPickClips(files);
  };

  // Reopen a project from the recent list; its saved draft is applied by the seed effect.
  const openProject = (p: ProjectMeta) => {
    audioPreviewRef.current?.pause();
    setPreviewPlaying(false);
    setSelectedExport(null);
    setError(null);
    setRanges([]);
    setMusicPart(null);
    lyricAnchorRef.current = null;
    setLyrics(null);
    setLyricsLoading(false);
    lyricsForRef.current = null;
    seededForRef.current = null;
    lastSavedForRef.current = null;
    setBulkMore(0);
    setProject(p);
  };

  const toggleLibraryClip = (id: string) =>
    setLibrarySelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllLibrary = () =>
    setLibrarySelected(new Set(libraryClips.map((c) => c.id)));

  const clearLibrarySelection = () => setLibrarySelected(new Set());

  const onLibraryUploaded = (clip: LibraryClip) => {
    setLibraryClips((prev) => [clip, ...prev]);
    setLibrarySelected((prev) => new Set(prev).add(clip.id));
  };

  const onLibraryDeleted = (id: string) => {
    setLibraryClips((prev) => prev.filter((c) => c.id !== id));
    setLibrarySelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateRow = (key: string, patch: Partial<Omit<RangeRow, "key">>) => {
    setRanges((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => setRanges((rows) => rows.filter((r) => r.key !== key));

  const toggleRowChecked = (key: string) =>
    setCheckedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const clearCheckedRows = () => setCheckedRows(new Set());

  const selectAllRows = () => setCheckedRows(new Set(ranges.map((r) => r.key)));

  const deleteCheckedRows = () => {
    const checked = checkedRows;
    setRanges((rows) => rows.filter((r) => !checked.has(r.key)));
    setCheckedRows(new Set());
  };

  const duplicateCheckedRows = () => {
    const checked = checkedRows;
    setRanges((rows) => [
      ...rows,
      ...rows.filter((r) => checked.has(r.key)).map((r) => makeRow(r.start, r.end)),
    ]);
  };

  const selectedRowCount = ranges.reduce((n, r) => n + (checkedRows.has(r.key) ? 1 : 0), 0);
  const allRowsChecked = ranges.length > 0 && selectedRowCount === ranges.length;

  // The chosen part of the song (from lyric clicks or the manual chooser).
  // null = the whole track. Validated before export: at least 1s, within the track.
  const partTrim = (): { start: number; end: number } | null => {
    const dur = project?.music?.durationSeconds;
    if (!dur || !musicPart) return null;
    const start = Math.max(0, Math.min(musicPart.start, dur));
    const end = Math.max(0, Math.min(musicPart.end, dur));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1) return null;
    return { start, end };
  };

  // Snap a time to the edges/lyric lines of the chosen song part (within 0.8s).
  const snapTime = (t: number): number => {
    const trim = partTrim();
    if (!trim) return t;
    const candidates: number[] = [trim.start, trim.end];
    if (lyrics) {
      for (const line of lyrics) {
        if (line.t > trim.start && line.t < trim.end) candidates.push(line.t);
      }
    }
    let best = t;
    let bestDiff = 0.8;
    for (const c of candidates) {
      const d = Math.abs(c - t);
      if (d < bestDiff) {
        bestDiff = d;
        best = c;
      }
    }
    return best;
  };

  const addRowAt = (t: number) => {
    if (!project) return;
    const rawStart = Math.max(0, Math.min(t, project.durationSeconds - 1));
    const start = snapTime(rawStart);
    let end = Math.min(project.durationSeconds, start + 4);
    const snappedEnd = snapTime(end);
    if (snappedEnd > start + 0.3) end = snappedEnd;
    if (end - start < 0.3) return;
    setRanges((rows) => [...rows, makeRow(start, end)]);
  };

  const seekSource = (t: number) => {
    const v = sourceVideoRef.current;
    if (!v || !project) return;
    v.currentTime = Math.max(0, Math.min(t, project.durationSeconds));
  };

  const timeAt = (clientX: number): number => {
    if (!project || !timelineRef.current || project.durationSeconds <= 0) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return frac * project.durationSeconds;
  };

  const onTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!project) return;
    const t = timeAt(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { anchor: t, startX: e.clientX, moved: false };
    suppressClickRef.current = false;
    setSel({ start: t, end: t });
  };

  const onTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !project) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 5) return;
    d.moved = true;
    const t = timeAt(e.clientX);
    setSel({ start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) });
  };

  const onTimelinePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !project) return;
    dragRef.current = null;
    if (!d.moved) {
      // Plain click: seek and clear any selection.
      seekSource(timeAt(e.clientX));
      setSel(null);
      return;
    }
    const t = timeAt(e.clientX);
    const start = Math.max(0, Math.min(d.anchor, t));
    const end = Math.min(project.durationSeconds, Math.max(d.anchor, t));
    if (end - start < 0.3) {
      setSel(null);
      return;
    }
    setSel({ start, end });
    suppressClickRef.current = true;
  };

  const addSelectedClip = () => {
    if (!project || !sel) return;
    let start = snapTime(Math.max(0, Math.min(sel.start, project.durationSeconds)));
    let end = snapTime(Math.max(0, Math.min(sel.end, project.durationSeconds)));
    if (end - start < 0.3) {
      // Snapping collapsed the range — fall back to the raw selection.
      start = Math.max(0, Math.min(sel.start, project.durationSeconds));
      end = Math.max(0, Math.min(sel.end, project.durationSeconds));
    }
    if (end - start < 0.3) return;
    setRanges((rows) => [...rows, makeRow(start, end)]);
    setSel(null);
  };

  const onLyricClick = (i: number) => {
    if (!lyrics) return;
    const dur = project?.music?.durationSeconds;
    const startT = lyrics[i]?.t;
    if (startT == null || dur == null) return;
    const endOf = (k: number) => lyrics[k + 1]?.t ?? dur;
    const anchor = lyricAnchorRef.current;
    if (anchor === null || anchor === i) {
      // First click starts a one-line segment; clicking the same line again clears it.
      if (anchor === i) {
        setMusicPart(null);
        lyricAnchorRef.current = null;
        return;
      }
      const end = endOf(i);
      if (end - startT < 1) return;
      setMusicPart({ start: startT, end });
      lyricAnchorRef.current = i;
      return;
    }
    // Second click on a different line: range from the anchor line to this one.
    const lo = Math.min(anchor, i);
    const hi = Math.max(anchor, i);
    const start = lyrics[lo]?.t;
    const end = endOf(hi);
    if (start == null || end - start < 1) return;
    setMusicPart({ start, end });
    lyricAnchorRef.current = null;
  };

  // Manual start/end entry in the song-part chooser.
  const setPartField = (field: "start" | "end", v: number) => {
    lyricAnchorRef.current = null;
    setMusicPart((p) => {
      const dur = project?.music?.durationSeconds ?? 0;
      const cur = p ?? { start: 0, end: dur };
      const next = { ...cur, [field]: Math.max(0, Math.min(v, dur)) };
      if (next.end - next.start < 1) {
        if (field === "start") next.start = Math.max(0, next.end - 1);
        else next.end = Math.min(dur, next.start + 1);
        if (next.end - next.start < 1) return p;
      }
      return next;
    });
  };

  const clearPart = () => {
    lyricAnchorRef.current = null;
    setMusicPart(null);
  };

  const togglePreview = () => {
    const a = audioPreviewRef.current;
    if (!a) return;
    if (previewPlaying) {
      a.pause();
      return;
    }
    a.currentTime = partTrim()?.start ?? 0;
    void a.play();
  };

  const startExport = async () => {
    if (!project) return;
    setError(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ranges: ranges.map(({ start, end }) => ({ start, end })),
          crop,
          format,
          includeMusic,
          musicVolume,
          musicMode,
          musicTrim: partTrim() ?? undefined,
        }),
      });
      const data = (await res.json()) as { job?: ExportJob; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Export failed to start.");
      const updated = await fetch(`/api/projects/${project.id}`, { cache: "no-store" }).then((r) =>
        r.json(),
      ) as { project: ProjectMeta };
      setProject(updated.project);
      setSelectedExport(data.job ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const downloadExport = (job: ExportJob) => {
    if (!project || !job.outputFile) return;
    const a = document.createElement("a");
    a.href = `/api/projects/${project.id}/exports/${job.outputFile}`;
    a.download = `framemuse-reel-${job.id.slice(0, 8)}-${job.format ?? "vertical"}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const validRanges = ranges.every(
    (r) =>
      Number.isFinite(r.start) &&
      Number.isFinite(r.end) &&
      r.start >= 0 &&
      r.end <= (project?.durationSeconds ?? 0) + 0.001 &&
      r.end - r.start >= 0.3,
  );

  const latestDone = project?.exports.find((e) => e.status === "done") ?? null;
  const activeJob = project?.exports.find((e) => e.status === "queued" || e.status === "rendering") ?? null;
  const displayJob = selectedExport ?? activeJob ?? latestDone;

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-zinc-100">
      <header className="border-b border-zinc-800/80 px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Frame<span className="text-amber-400/90">Muse</span>
          </h1>
          <p className="text-xs text-zinc-500">Turn long videos into stories worth watching.</p>
        </div>
        {!project && (
          <nav className="flex rounded-full border border-zinc-700 p-0.5 bg-zinc-950/60">
            {(
              [
                { key: "studio", label: "🎬 Studio" },
                { key: "library", label: `🎞️ Library${libraryClips.length > 0 ? ` (${libraryClips.length})` : ""}` },
                { key: "recreate", label: "✨ Recreate" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setView(tab.key)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                  homeView === tab.key
                    ? "bg-amber-500 text-black shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}
        {tools?.ffmpeg === false && (
          <p className="text-xs text-red-400 max-w-xs text-right">
            FFmpeg not found. Install with <code className="bg-zinc-800 px-1 rounded">brew install ffmpeg</code>.
          </p>
        )}
        {tools?.ytDlp === false && (
          <p className="text-xs text-amber-400 max-w-xs text-right">
            Link import unavailable. Install with <code className="bg-zinc-800 px-1 rounded">brew install yt-dlp</code>.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {error && (
          <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!project ? (
          <>
          {homeView === "library" ? (
            <LibrarySection
              clips={libraryClips}
              selectedIds={librarySelected}
              onToggleSelect={toggleLibraryClip}
              onSelectAll={selectAllLibrary}
              onClearSelection={clearLibrarySelection}
              onUploaded={onLibraryUploaded}
              onDelete={onLibraryDeleted}
              onGoRecreate={() => setView("recreate")}
            />
          ) : homeView === "recreate" ? (
            <RecreateSection
              clips={libraryClips}
              selectedIds={librarySelected}
              onGoLibrary={() => setView("library")}
            />
          ) : (
          <>
          <section className="space-y-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">Add Media to Studio</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Select multiple clips from your device or paste links to get started.
                  </p>
                </div>
                <div className="flex rounded-full border border-zinc-700 p-0.5 bg-zinc-950/60">
                  <button
                    type="button"
                    onClick={() => setActiveMediaTab("clips")}
                    className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                      activeMediaTab === "clips"
                        ? "bg-amber-500 text-black shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    📁 Local Video Clips {stagedItems.filter((i) => i.type === "file").length > 0 ? `(${stagedItems.filter((i) => i.type === "file").length})` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMediaTab("links")}
                    className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                      activeMediaTab === "links"
                        ? "bg-amber-500 text-black shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    🔗 Web Video Links {stagedItems.filter((i) => i.type === "link").length > 0 ? `(${stagedItems.filter((i) => i.type === "link").length})` : ""}
                  </button>
                </div>
              </div>

              {activeMediaTab === "clips" ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    onPickClips(e.dataTransfer.files);
                  }}
                  className={`rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all ${
                    dragOver ? "border-amber-400/80 bg-amber-400/10" : "border-zinc-700 bg-zinc-950/40"
                  }`}
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-amber-400 text-xl mb-3">
                    🎥
                  </div>
                  <p className="text-base font-medium text-zinc-100">Drop video clips here</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    MP4, MOV, M4V, WEBM, or MKV · Select one or multiple files
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-5 rounded-full bg-amber-500/90 px-6 py-2 text-sm font-medium text-black hover:bg-amber-400 transition-colors shadow-sm"
                  >
                    Choose Files (Multi-Select)
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/x-matroska"
                    className="hidden"
                    onChange={(e) => onPickClips(e.target.files)}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-700/80 bg-zinc-950/40 p-6 space-y-3">
                  <p className="text-sm font-medium text-zinc-200">Paste Video Links</p>
                  <p className="text-xs text-zinc-500">
                    Paste YouTube, Shorts, or other video URLs. You can paste several links separated by spaces or new lines!
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={linkInputText}
                      onChange={(e) => setLinkInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && linkInputText.trim()) {
                          e.preventDefault();
                          addLinksFromText(linkInputText);
                        }
                      }}
                      placeholder="https://youtube.com/watch?v=… (paste one or multiple links)"
                      className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!linkInputText.trim()}
                      onClick={() => addLinksFromText(linkInputText)}
                      className="rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
                    >
                      + Add Link
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Staged Items / Selection Option UI */}
            {stagedItems.length > 0 && (
              <section className="rounded-2xl border border-amber-500/40 bg-zinc-900/60 p-5 space-y-4 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                      <span>Selected Media Queue</span>
                      <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs text-amber-300 font-mono">
                        {stagedItems.filter((i) => i.selected).length} of {stagedItems.length} selected
                      </span>
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {stagedItems.filter((i) => i.selected && i.type === "file").length} clip{stagedItems.filter((i) => i.selected && i.type === "file").length === 1 ? "" : "s"}
                      {stagedItems.filter((i) => i.selected && i.type === "link").length > 0 ? ` · ${stagedItems.filter((i) => i.selected && i.type === "link").length} link${stagedItems.filter((i) => i.selected && i.type === "link").length === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={stagedItems.every((i) => i.selected) ? deselectAllStaged : selectAllStaged}
                      className="text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      {stagedItems.every((i) => i.selected) ? "Deselect all" : "Select all"}
                    </button>
                    <span className="text-zinc-700">·</span>
                    <button
                      type="button"
                      onClick={clearAllStaged}
                      className="text-xs text-zinc-500 hover:text-red-400"
                    >
                      Clear all
                    </button>
                  </div>
                </div>

                {/* Staged list */}
                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                  {stagedItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                        item.selected
                          ? "border-amber-500/40 bg-zinc-950/80 text-zinc-100"
                          : "border-zinc-800/80 bg-zinc-950/30 text-zinc-500"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => toggleStagedItem(item.id)}
                        className="h-4 w-4 rounded accent-amber-400"
                      />
                      <span className="text-base">{item.type === "file" ? "🎥" : "🔗"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-zinc-200">{item.name}</p>
                        <p className="truncate text-[11px] text-zinc-500">
                          {item.type === "file" ? fmtSize(item.size) : item.url}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStagedItem(item.id)}
                        className="text-xs text-zinc-500 hover:text-red-400 p-1"
                        title="Remove item"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* Selection Option: Mode Chooser */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Import Option
                  </span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        importMode === "combine"
                          ? "border-amber-400/80 bg-amber-400/10 text-amber-200"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="importMode"
                        value="combine"
                        checked={importMode === "combine"}
                        onChange={() => setImportMode("combine")}
                        className="mt-1 accent-amber-400"
                      />
                      <div className="text-xs">
                        <p className="font-medium text-zinc-100">Combine into Single Reel (Recommended)</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          Stitches all selected clips and links into a single continuous master timeline so you can cut moments from all of them.
                        </p>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        importMode === "separate"
                          ? "border-amber-400/80 bg-amber-400/10 text-amber-200"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="importMode"
                        value="separate"
                        checked={importMode === "separate"}
                        onChange={() => setImportMode("separate")}
                        className="mt-1 accent-amber-400"
                      />
                      <div className="text-xs">
                        <p className="font-medium text-zinc-100">Create Separate Projects</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          Imports each selected clip and link as an independent project in your recent projects list.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* CTA Action */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={stagedItems.filter((i) => i.selected).length === 0 || importing}
                    onClick={() => void startImportStaged()}
                    className="rounded-full bg-amber-500 px-8 py-2.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all"
                  >
                    {importing
                      ? "Processing…"
                      : `Import ${stagedItems.filter((i) => i.selected).length} Selected ${stagedItems.filter((i) => i.selected).length === 1 ? "Item" : "Items"} →`}
                  </button>
                  {importing && importProgressText && (
                    <span className="text-xs text-amber-300 animate-pulse">{importProgressText}</span>
                  )}
                </div>

                {importing && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800 mt-2">
                    <div
                      className="h-full bg-amber-400 transition-all duration-300"
                      style={{ width: `${Math.max(5, Math.min(100, importOverallPct))}%` }}
                    />
                  </div>
                )}
              </section>
            )}
          </section>

          {recent !== null && recent.length > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-zinc-300">Recent projects</p>
                <p className="text-[11px] text-zinc-600">
                  Clips, settings and song part are saved — reopen to continue
                </p>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {recent.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openProject(p)}
                      className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-left transition-colors hover:border-amber-500/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-200">
                          {p.originalName}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-zinc-600">
                          {fmtTime(p.durationSeconds)} ·{" "}
                          {new Date(p.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                      {p.ingest && p.ingest.status !== "ready" ? (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                          {p.ingest.status === "error" ? "failed" : "importing…"}
                        </span>
                      ) : p.music?.status === "ready" ? (
                        <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                          ♪ music
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          </>
          )}
          </>
        ) : project.ingest && project.ingest.status !== "ready" ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
            {project.ingest.status === "error" ? (
              <>
                <p className="text-sm text-red-400">
                  {project.ingest.error ?? "Import failed."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setProject(null);
                    setError(null);
                  }}
                  className="mt-6 rounded-full border border-zinc-700 px-5 py-2 text-sm text-zinc-300 hover:border-zinc-500"
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                <p className="mt-4 text-sm text-zinc-300">
                  {project.ingest.detail ||
                    (project.ingest.status === "downloading"
                      ? `Downloading from link… ${project.ingest.progress ?? 0}%`
                      : "Preparing video…")}
                </p>
                {typeof project.ingest.progress === "number" && (
                  <div className="mx-auto mt-4 h-1.5 max-w-sm overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-amber-400 transition-all duration-300"
                      style={{ width: `${Math.max(5, Math.min(100, project.ingest.progress))}%` }}
                    />
                  </div>
                )}
                <p className="mt-3 text-xs text-zinc-600 break-all max-w-lg mx-auto">
                  {project.sourceUrl}
                </p>
                {bulkMore > 0 && (
                  <p className="mt-2 text-xs text-amber-300/90">
                    {bulkMore} more video{bulkMore === 1 ? " is" : "s are"} importing in the
                    background — when done, find {bulkMore === 1 ? "it" : "them"} under Recent
                    projects on the home screen.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setProject(null)}
                  className="mt-6 rounded-full border border-zinc-700 px-5 py-2 text-xs text-zinc-400 hover:border-zinc-500"
                >
                  Back
                </button>
              </>
            )}
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-medium">{project.originalName}</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    {fmtTime(project.durationSeconds)} · {project.width}×{project.height}
                    {project.fps ? ` · ${project.fps} fps` : ""}
                    {project.hasAudio ? " · audio" : " · no audio"}
                    {project.videoCodec ? ` · ${project.videoCodec}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProject(null);
                    setRanges([]);
                    setSelectedExport(null);
                    setCheckedRows(new Set());
                    setBulkMore(0);
                    setError(null);
                  }}
                  className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  ← Change / Add media
                </button>
              </div>

              {project.segments && project.segments.length > 1 && (
                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/90 flex items-center gap-1.5">
                      <span>Combined Clips &amp; Links</span>
                      <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] text-amber-300 font-mono">
                        {project.segments.length} parts
                      </span>
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      Click any clip to jump to its timestamp
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {project.segments.map((seg, idx) => {
                      const isActive = playhead >= seg.start && playhead < seg.end;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => seekSource(seg.start)}
                          title={`Jump to ${seg.name} (${fmtTime(seg.start)} - ${fmtTime(seg.end)})`}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all ${
                            isActive
                              ? "border-amber-400 bg-amber-400/15 text-amber-300 font-medium shadow-sm"
                              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                          }`}
                        >
                          <span>{seg.sourceType === "file" ? "🎥" : "🔗"}</span>
                          <span className="max-w-[140px] truncate">{seg.name}</span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            {fmtTime(seg.start)}–{fmtTime(seg.end)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800 bg-black">
                <video
                  ref={sourceVideoRef}
                  src={`/api/projects/${project.id}/source`}
                  controls
                  preload="metadata"
                  playsInline
                  onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
                  onSeeked={(e) => setPlayhead(e.currentTarget.currentTime)}
                  className="mx-auto max-h-[45vh] w-full"
                />
              </div>

              {/* YouTube-style timeline: red progress line + a red block for every clip.
                  Drag to select a span and add it as a clip; click to seek. */}
              <div
                ref={timelineRef}
                onPointerDown={onTimelinePointerDown}
                onPointerMove={onTimelinePointerMove}
                onPointerUp={onTimelinePointerUp}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setSel(null);
                }}
                title="Drag to select a clip, click to seek"
                className="group relative mt-3 h-4 cursor-crosshair touch-none select-none rounded-full bg-zinc-800"
              >
                {project.durationSeconds > 0 &&
                  ranges.map((row, idx) => {
                    const left = (Math.max(0, row.start) / project.durationSeconds) * 100;
                    const width =
                      ((Math.min(project.durationSeconds, row.end) - Math.max(0, row.start)) /
                        project.durationSeconds) *
                      100;
                    if (width <= 0) return null;
                    return (
                      <div
                        key={row.key}
                        title={`Clip ${idx + 1}: ${fmtTime(row.start)} – ${fmtTime(row.end)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (suppressClickRef.current) return;
                          seekSource(row.start);
                        }}
                        className="absolute inset-y-0 rounded-sm bg-red-600/60 hover:bg-red-500"
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    );
                  })}
                {project.durationSeconds > 0 &&
                  project.segments &&
                  project.segments.map((seg, idx) => {
                    if (idx === 0) return null;
                    const pos = (seg.start / project.durationSeconds) * 100;
                    return (
                      <div
                        key={`seg-line-${idx}`}
                        title={`Clip transition: ${seg.name}`}
                        className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-400/60 z-10"
                        style={{ left: `${pos}%` }}
                      />
                    );
                  })}
                {sel && project.durationSeconds > 0 && (
                  <div
                    className="pointer-events-none absolute inset-y-0 rounded-sm border border-amber-300 bg-amber-400/30"
                    style={{
                      left: `${(Math.max(0, sel.start) / project.durationSeconds) * 100}%`,
                      width: `${
                        ((Math.min(project.durationSeconds, sel.end) -
                          Math.max(0, sel.start)) /
                          project.durationSeconds) *
                        100
                      }%`,
                    }}
                  />
                )}
                <div
                  className="pointer-events-none absolute inset-y-[5px] left-0 rounded-full bg-red-500"
                  style={{
                    width: `${
                      project.durationSeconds > 0
                        ? Math.max(0, Math.min(100, (playhead / project.durationSeconds) * 100))
                        : 0
                    }%`,
                  }}
                />
                <div
                  className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500 bg-white opacity-0 transition-opacity group-hover:opacity-100"
                  style={{
                    left: `${
                      project.durationSeconds > 0
                        ? Math.max(0, Math.min(100, (playhead / project.durationSeconds) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
                <span>{fmtTime(playhead)}</span>
                <span>{fmtTime(project.durationSeconds)}</span>
              </div>

              {sel && (
                <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <span className="text-xs font-medium text-amber-300">New clip</span>
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    start
                    <input
                      value={Number.isFinite(sel.start) ? String(Math.round(sel.start * 10) / 10) : ""}
                      onChange={(e) => {
                        const v = parseTime(e.target.value);
                        if (v !== null) setSel((s) => (s ? { ...s, start: v } : s));
                      }}
                      onBlur={() =>
                        setSel((s) =>
                          s
                            ? {
                                ...s,
                                start: Math.max(0, Math.min(s.start, project.durationSeconds)),
                              }
                            : s,
                        )
                      }
                      inputMode="decimal"
                      className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    end
                    <input
                      value={Number.isFinite(sel.end) ? String(Math.round(sel.end * 10) / 10) : ""}
                      onChange={(e) => {
                        const v = parseTime(e.target.value);
                        if (v !== null) setSel((s) => (s ? { ...s, end: v } : s));
                      }}
                      onBlur={() =>
                        setSel((s) =>
                          s
                            ? {
                                ...s,
                                end: Math.max(0, Math.min(s.end, project.durationSeconds)),
                              }
                            : s,
                        )
                      }
                      inputMode="decimal"
                      className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>
                  <span className="text-xs text-zinc-500">
                    {fmtTime(Math.max(0, Math.min(sel.end, project.durationSeconds) - Math.max(0, sel.start)))}
                  </span>
                  <button
                    type="button"
                    onClick={addSelectedClip}
                    disabled={sel.end - sel.start < 0.3}
                    className="ml-auto rounded-full bg-amber-500/90 px-4 py-1 text-xs font-medium text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    + Add clip to project
                  </button>
                  <button
                    type="button"
                    onClick={() => setSel(null)}
                    className="text-xs text-zinc-500 hover:text-red-400"
                  >
                    cancel
                  </button>
                </div>
              )}

              <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {Array.from({ length: project.thumbCount }, (_, i) => {
                  const t = i * project.thumbInterval + project.thumbInterval / 2;
                  return (
                    <button
                      key={i}
                      type="button"
                      title={`Add range at ${fmtTime(t)}`}
                      onClick={() => addRowAt(t)}
                      className="group relative overflow-hidden rounded-md border border-zinc-800 hover:border-amber-400/70"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/projects/${project.id}/thumbs/${i}`}
                        alt={`Thumbnail at ${fmtTime(t)}`}
                        className="aspect-video w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-0.5 right-1 text-[10px] text-white/80 drop-shadow">
                        {fmtTime(t)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-zinc-600">
                Red blocks are your clips — click one to jump to it. Drag across the timeline to
                pick a time span, fine-tune it, then add it as a clip. Click a thumbnail to add a
                clip at that moment.
              </p>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Clip ranges</h2>
                <div className="flex items-center gap-3">
                  {ranges.length > 0 && (
                    <button
                      type="button"
                      onClick={allRowsChecked ? clearCheckedRows : selectAllRows}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      {allRowsChecked ? "clear selection" : "select all"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRanges((rows) => [...rows, makeRow(0, Math.min(4, project.durationSeconds))])}
                    className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                  >
                    + Add range
                  </button>
                </div>
              </div>

              {selectedRowCount > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <span className="text-xs text-amber-200">
                    {selectedRowCount} clip{selectedRowCount === 1 ? "" : "s"} selected
                  </span>
                  <button
                    type="button"
                    onClick={duplicateCheckedRows}
                    className="rounded-full border border-amber-400/60 px-3 py-1 text-xs text-amber-200 hover:bg-amber-400/15"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={deleteCheckedRows}
                    className="rounded-full border border-red-800/70 px-3 py-1 text-xs text-red-300 hover:bg-red-950/30"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={clearCheckedRows}
                    className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    clear
                  </button>
                </div>
              )}
              <div className="mt-4 space-y-3">
                {ranges.map((row, idx) => {
                  const checked = checkedRows.has(row.key);
                  const bad =
                    row.start < 0 ||
                    row.end > project.durationSeconds + 0.001 ||
                    row.end - row.start < 0.3;
                  return (
                    <div
                      key={row.key}
                      className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${
                        checked
                          ? "border-amber-500/60 bg-amber-500/10"
                          : bad
                            ? "border-red-800/70 bg-red-950/20"
                            : "border-zinc-800 bg-zinc-950/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRowChecked(row.key)}
                        aria-label={`Select clip ${idx + 1}`}
                        className="h-4 w-4 shrink-0 accent-amber-400"
                      />
                      <span className="w-6 text-xs text-zinc-500">#{idx + 1}</span>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        start
                        <input
                          value={Number.isFinite(row.start) ? String(Math.round(row.start * 10) / 10) : ""}
                          onChange={(e) => {
                            const v = parseTime(e.target.value);
                            if (v !== null) updateRow(row.key, { start: v });
                          }}
                          onBlur={(e) => {
                            if (parseTime(e.target.value) === null)
                              updateRow(row.key, { start: Math.min(row.start, project.durationSeconds) });
                          }}
                          inputMode="decimal"
                          className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        end
                        <input
                          value={Number.isFinite(row.end) ? String(Math.round(row.end * 10) / 10) : ""}
                          onChange={(e) => {
                            const v = parseTime(e.target.value);
                            if (v !== null) updateRow(row.key, { end: v });
                          }}
                          onBlur={(e) => {
                            if (parseTime(e.target.value) === null)
                              updateRow(row.key, { end: Math.min(row.end, project.durationSeconds) });
                          }}
                          inputMode="decimal"
                          className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                        />
                      </label>
                      <span className="text-xs text-zinc-500">{fmtTime(Math.max(0, row.end - row.start))}</span>
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        className="ml-auto text-xs text-zinc-500 hover:text-red-400"
                      >
                        remove
                      </button>
                    </div>
                  );
                })}
                {ranges.length === 0 && (
                  <p className="text-sm text-zinc-600">No ranges yet. Click a thumbnail or add a range.</p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-300">Format</span>
                  <div className="flex rounded-full border border-zinc-700 p-0.5">
                    {(
                      [
                        ["vertical", "Vertical 9:16"],
                        ["horizontal", "Horizontal 16:9"],
                        ["fit", "Fit in vertical"],
                      ] as [ExportFormat, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFormat(value)}
                        className={`rounded-full px-3 py-1 text-xs transition-colors ${
                          format === value
                            ? "bg-amber-500/90 text-black"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {format !== "fit" && (
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    Crop position
                    <select
                      value={crop}
                      onChange={(e) => setCrop(e.target.value as CropPosition)}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs focus:border-amber-500/60 focus:outline-none"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => void startExport()}
                  disabled={!validRanges || ranges.length === 0 || exporting || Boolean(activeJob)}
                  className="rounded-full bg-amber-500/90 px-6 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exporting || activeJob ? "Rendering…" : "Export reel"}
                </button>
                <span className="text-xs text-zinc-500">
                  {ranges.length} clip{ranges.length === 1 ? "" : "s"} ·{" "}
                  {fmtTime(ranges.reduce((acc, r) => acc + Math.max(0, r.end - r.start), 0))} total ·{" "}
                  {format === "horizontal" ? "1920×1080" : "1080×1920"}
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Music</h2>
                {project.music?.status === "ready" && (
                  <button
                    type="button"
                    onClick={() => void removeMusic()}
                    className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:border-red-800 hover:text-red-400"
                  >
                    Remove track
                  </button>
                )}
              </div>

              {(project.music?.status === "downloading" ||
                project.music?.status === "processing") && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-3 text-sm text-zinc-400">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                    {project.music.status === "downloading"
                      ? `Downloading track… ${project.music.progress ?? 0}%`
                      : "Preparing track…"}
                  </div>
                  {project.music.status === "downloading" && (
                    <div className="h-1.5 max-w-sm overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full bg-amber-400 transition-all"
                        style={{ width: `${project.music.progress ?? 0}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {project.music?.status === "ready" && (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-zinc-300">
                    {project.music.title}
                    {project.music.durationSeconds
                      ? ` · ${fmtTime(project.music.durationSeconds)}`
                      : ""}
                  </p>

                  <div className="flex flex-wrap items-center gap-5">
                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={includeMusic}
                        onChange={(e) => setIncludeMusic(e.target.checked)}
                        className="h-4 w-4 accent-amber-400"
                      />
                      Include in export
                    </label>

                    <label className="flex items-center gap-3 text-sm text-zinc-300">
                      Volume
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(musicVolume * 100)}
                        onChange={(e) => setMusicVolume(Number(e.target.value) / 100)}
                        className="w-40 accent-amber-400"
                      />
                      <span className="w-9 text-right text-xs text-zinc-500">
                        {Math.round(musicVolume * 100)}%
                      </span>
                    </label>

                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-300">Audio</span>
                      <div className="flex rounded-full border border-zinc-700 p-0.5">
                        {(
                          [
                            ["mix", "Mix with video"],
                            ["replace", "Replace video audio"],
                          ] as [MusicMode, string][]
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setMusicMode(value)}
                            className={`rounded-full px-3 py-1 text-xs transition-colors ${
                              musicMode === value
                                ? "bg-amber-500/90 text-black"
                                : "text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-600">
                    The track loops automatically if the reel is longer. Replace = only the track
                    plays; Mix = original audio + track together.
                  </p>

                  {/* Pick which part of the song the reel uses — type exact times
                      or click lyric lines below. Works even without lyrics. */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-300">
                        Song part used in the reel
                        <span className="ml-2 font-normal text-zinc-600">default: whole song</span>
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={togglePreview}
                          className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition-colors hover:border-amber-500/60 hover:text-amber-300"
                        >
                          {previewPlaying ? "■ Stop" : musicPart ? "▶ Preview part" : "▶ Preview song"}
                        </button>
                        {musicPart && (
                          <button
                            type="button"
                            onClick={clearPart}
                            className="text-xs text-zinc-500 hover:text-red-400"
                          >
                            whole song
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="relative mt-2 h-5 overflow-hidden rounded bg-zinc-900 ring-1 ring-zinc-800">
                      {(() => {
                        const dur = project.music.durationSeconds;
                        const p = partTrim();
                        if (!dur) return null;
                        if (!p) return <div className="absolute inset-0 bg-amber-400/15" />;
                        const left = (p.start / dur) * 100;
                        const width = Math.max(1, ((p.end - p.start) / dur) * 100);
                        return (
                          <div
                            className="absolute inset-y-0 border-x border-amber-300 bg-amber-400/35"
                            style={{ left: `${left}%`, width: `${width}%` }}
                          />
                        );
                      })()}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        start
                        <input
                          value={
                            Number.isFinite(musicPart?.start ?? 0)
                              ? String(Math.round((musicPart?.start ?? 0) * 10) / 10)
                              : ""
                          }
                          onChange={(e) => {
                            const v = parseTime(e.target.value);
                            if (v !== null) setPartField("start", v);
                          }}
                          onBlur={(e) => {
                            const v = parseTime(e.target.value);
                            if (v === null) setMusicPart((p) => (p ? { ...p } : p));
                            else setPartField("start", v);
                          }}
                          inputMode="decimal"
                          placeholder="0"
                          className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        end
                        <input
                          value={
                            Number.isFinite(musicPart?.end ?? project.music.durationSeconds ?? 0)
                              ? String(
                                  Math.round(
                                    (musicPart?.end ?? project.music.durationSeconds ?? 0) * 10,
                                  ) / 10,
                                )
                              : ""
                          }
                          onChange={(e) => {
                            const v = parseTime(e.target.value);
                            if (v !== null) setPartField("end", v);
                          }}
                          onBlur={(e) => {
                            const v = parseTime(e.target.value);
                            if (v === null) setMusicPart((p) => (p ? { ...p } : p));
                            else setPartField("end", v);
                          }}
                          inputMode="decimal"
                          placeholder={String(project.music.durationSeconds ?? 0)}
                          className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
                        />
                      </label>
                      <span className="text-xs text-zinc-500">
                        {(() => {
                          const p = partTrim();
                          const dur = project.music?.durationSeconds ?? 0;
                          return p
                            ? `${fmtTime(p.end - p.start)} of ${fmtTime(dur)}`
                            : `whole song · ${fmtTime(dur)}`;
                        })()}
                      </span>
                      <span className="ml-auto text-xs text-zinc-600">
                        Type exact times, or click lyrics below
                      </span>
                    </div>
                  </div>

                  <audio
                    ref={audioPreviewRef}
                    src={`/api/projects/${project.id}/music/file`}
                    preload="none"
                    className="hidden"
                    onPlay={() => setPreviewPlaying(true)}
                    onPause={() => setPreviewPlaying(false)}
                    onEnded={() => setPreviewPlaying(false)}
                    onError={() => setPreviewPlaying(false)}
                    onTimeUpdate={() => {
                      const a = audioPreviewRef.current;
                      const p = partTrim();
                      if (a && p && a.currentTime >= p.end) a.pause();
                    }}
                  />

                  {lyricsLoading && (
                    <p className="text-xs text-zinc-500">Looking up synced lyrics…</p>
                  )}
                  {!lyricsLoading && lyrics && lyrics.length === 0 && (
                    <p className="text-xs text-zinc-600">
                      No synced lyrics found for this track — you can still pick the song part
                      above, but clips won&apos;t snap to words.
                    </p>
                  )}
                  {!lyricsLoading && lyrics && lyrics.length > 0 && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-400">
                          Lyrics — click a line to start, then another to end. Clip cuts snap to
                          these lines.
                        </span>
                        {musicPart && (
                          <button
                            type="button"
                            onClick={clearPart}
                            className="text-xs text-zinc-500 hover:text-red-400"
                          >
                            clear part
                          </button>
                        )}
                      </div>
                      <div className="mt-2 max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
                        {lyrics.map((line, i) => {
                          const p = partTrim();
                          const inSel =
                            Boolean(p) &&
                            line.t >= (p?.start ?? 0) - 1e-6 &&
                            line.t < (p?.end ?? 0) - 1e-6;
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => onLyricClick(i)}
                              className={`block w-full rounded px-2 py-1 text-left text-xs transition-colors ${
                                inSel
                                  ? "bg-amber-400/15 text-amber-200"
                                  : "text-zinc-400 hover:bg-zinc-800/60"
                              }`}
                            >
                              <span className="mr-2 inline-block w-9 font-mono text-[10px] text-zinc-600">
                                {fmtShort(line.t)}
                              </span>
                              {line.text}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(!project.music || project.music.status === "error") && (
                <div className="mt-4">
                  <div className="relative flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        type="text"
                        value={musicUrl}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMusicUrl(v);
                          const q = v.trim();
                          if (q.length < 2 || /^https?:\/\//i.test(q)) {
                            setSearchOpen(false);
                            setSearchResults([]);
                            setSearchFor("");
                            setSearchLoading(false);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && musicUrl.trim() && !musicImporting)
                            void importMusic();
                          if (e.key === "Escape") setSearchOpen(false);
                        }}
                        onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
                        placeholder='Search a song name (or a vibe like "cinematography") or paste a link'
                        disabled={musicImporting}
                        className="w-full rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
                      />
                      {searchOpen && (searchResults.length > 0 || searchLoading) && (
                        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
                          {searchLoading && (
                            <p className="px-3 py-2 text-xs text-zinc-500">Searching…</p>
                          )}
                          {searchResults.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => void importMusic(r.url)}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-800"
                            >
                              <span className="min-w-0 truncate text-zinc-200">{r.title}</span>
                              <span className="flex-shrink-0 text-[11px] text-zinc-500">
                                {r.duration != null ? fmtShort(r.duration) : ""}
                                {r.channel ? ` · ${r.channel}` : ""}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={musicImporting || !musicUrl.trim()}
                      onClick={() => void importMusic()}
                      className="flex-shrink-0 rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
                    >
                      {musicImporting ? "Starting…" : "Add track"}
                    </button>
                  </div>
                  {project.music?.status === "error" && (
                    <p className="mt-2 text-xs text-red-400">
                      {project.music.error ?? "Music import failed."}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-zinc-600">
                    Only use music you own or have the rights to — platforms may mute reels with
                    unlicensed audio.
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="font-medium">Reel preview</h2>
              {displayJob ? (
                <div className="mt-4 space-y-4">
                  {project.exports.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {project.exports.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => setSelectedExport(job)}
                          className={`rounded-full px-3 py-1 text-xs ${
                            displayJob.id === job.id
                              ? "bg-amber-500/90 text-black"
                              : "border border-zinc-700 text-zinc-300 hover:border-zinc-500"
                          }`}
                        >
                          {job.status === "done"
                            ? `v${project.exports.indexOf(job) + 1}`
                            : job.status === "error"
                              ? "failed"
                              : "rendering…"}
                        </button>
                      ))}
                    </div>
                  )}

                  {(displayJob.status === "queued" || displayJob.status === "rendering") && (
                    <div className="flex items-center gap-3 text-sm text-zinc-400">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                      Rendering vertical reel… this runs FFmpeg in the background.
                    </div>
                  )}
                  {displayJob.status === "error" && (
                    <p className="text-sm text-red-400">Render failed: {displayJob.error}</p>
                  )}
                  {displayJob.status === "done" && displayJob.outputFile && (
                    <>
                      <video
                        ref={videoRef}
                        key={displayJob.id}
                        controls
                        playsInline
                        className={`mx-auto max-h-[60vh] rounded-xl border border-zinc-800 bg-black ${
                          (displayJob.format ?? "vertical") === "horizontal"
                            ? "aspect-video w-full max-w-3xl"
                            : "aspect-[9/16]"
                        }`}
                        src={`/api/projects/${project.id}/exports/${displayJob.outputFile}`}
                      />
                      <div className="flex justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => downloadExport(displayJob)}
                          className="rounded-full border border-amber-500/60 px-6 py-2 text-sm text-amber-300 hover:bg-amber-500/10"
                        >
                          Download MP4
                        </button>
                        <span className="self-center text-xs text-zinc-600">
                          {(displayJob.format ?? "vertical") === "horizontal"
                            ? "1920×1080 · horizontal"
                            : (displayJob.format ?? "vertical") === "fit"
                              ? "1080×1920 · horizontal letterboxed"
                              : "1080×1920 · vertical fill"}
                          {displayJob.music
                            ? displayJob.music.trim
                              ? " · music lyric segment"
                              : " · with music"
                            : ""}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-600">No renders yet. Export a draft to see it here.</p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
