"use client";

import { useRef, useState } from "react";
import type { LibraryClip } from "@/lib/types";

function fmtClipTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isVideoFileName(name: string): boolean {
  return /\.(mp4|mov|m4v|webm|mkv)$/i.test(name);
}

type Props = {
  clips: LibraryClip[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onUploaded: (clip: LibraryClip) => void;
  onDelete: (id: string) => void;
  onGoRecreate: () => void;
};

export default function LibrarySection({
  clips,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onUploaded,
  onDelete,
  onGoRecreate,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadClip = (file: File): Promise<LibraryClip> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/library");
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      if (tagsText.trim()) {
        xhr.setRequestHeader("x-clip-tags", tagsText.trim());
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* noop */
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve((body as { clip: LibraryClip }).clip);
        } else {
          const msg = (body as { error?: string } | null)?.error ?? `Upload failed (${xhr.status}).`;
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(file);
    });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploading) return;
    setUploadError(null);
    const valid = Array.from(files).filter((f) => isVideoFileName(f.name));
    if (valid.length === 0) {
      setUploadError("No valid video files. Use MP4, MOV, M4V, WEBM, or MKV.");
      return;
    }
    setUploading(true);
    try {
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        setUploadName(`${file.name} (${i + 1}/${valid.length})`);
        setUploadPct(0);
        const clip = await uploadClip(file);
        onUploaded(clip);
      }
      setTagsText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadName(null);
      setUploadPct(0);
    }
  };

  const removeClip = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/library/${id}`, { method: "DELETE" });
      if (res.ok) onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  const selectedCount = selectedIds.size;
  const allSelected = clips.length > 0 && selectedCount === clips.length;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#292929] bg-[#141414] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-base font-semibold text-[#F5F5F0] flex items-center gap-2">
              Clip Library
              <span className="rounded-full bg-[#FFC800]/15 px-2.5 py-0.5 text-xs text-[#FFC800] font-mono">
                {clips.length} clip{clips.length === 1 ? "" : "s"}
              </span>
            </h2>
            <p className="text-xs text-[#929292] mt-0.5">
              Your best footage, in one place. When you recreate a reel, the AI picks clips from
              here, writes captions, and cuts to the trend&apos;s pacing.
            </p>
          </div>
          {clips.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={allSelected ? onClearSelection : onSelectAll}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
              <span className="text-zinc-700">·</span>
              <button
                type="button"
                onClick={onGoRecreate}
                className="rounded-full bg-[#FFC800] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#D99A00] transition-colors"
              >
                Recreate a Reel →
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={`rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-all ${
              dragOver ? "border-[#FFC800]/80 bg-[#FFC800]/10" : "border-[#292929] bg-[#101010]"
            }`}
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-[#FFC800] text-lg mb-2">
              🎞️
            </div>
            <p className="text-sm font-medium text-zinc-100">Drop clips to add to library</p>
            <p className="mt-1 text-[11px] text-zinc-500">MP4, MOV, M4V, WEBM, MKV</p>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 rounded-full bg-zinc-100 px-5 py-1.5 text-xs font-medium text-black hover:bg-white disabled:opacity-50"
            >
              Choose Clips
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/x-matroska"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>

          <div className="rounded-2xl border border-[#292929] bg-[#101010] p-4 flex flex-col justify-center gap-2">
            <label className="text-xs font-medium text-zinc-300">
              Tags for new clips{" "}
              <span className="font-normal text-zinc-500">(comma separated)</span>
            </label>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="travel, drone, b-roll, city night…"
              className="w-full rounded-full border border-[#292929] bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#FFC800]/60 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500">
              Tags help the AI match the right clip to each shot.
            </p>
            {uploading && (
              <div className="mt-1 space-y-1.5">
                <p className="text-xs text-[#FFC800] animate-pulse truncate">
                  Uploading {uploadName}…
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-[#FFC800] transition-all duration-300"
                    style={{ width: `${Math.max(4, uploadPct)}%` }}
                  />
                </div>
              </div>
            )}
            {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
          </div>
        </div>

        {clips.length === 0 ? (
          <div className="rounded-xl border border-[#292929] bg-[#101010] px-4 py-10 text-center">
            <p className="text-sm text-zinc-400">No clips yet.</p>
            <p className="text-xs text-zinc-600 mt-1">
              Add your best footage above — the AI will pull from it when recreating reels.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-[#292929] pb-2 mb-3">
              <p className="text-xs text-zinc-400">
                {selectedCount > 0 ? (
                  <span className="text-[#FFC800] font-medium">
                    {selectedCount} selected for recreation
                  </span>
                ) : (
                  "Select clips to use in a recreation (or leave all selected by default)"
                )}
              </p>
              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="text-xs text-zinc-500 hover:text-red-400"
                >
                  Clear selection
                </button>
              )}
            </div>

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {clips.map((clip) => {
                const isSelected = selectedIds.has(clip.id);
                return (
                  <li
                    key={clip.id}
                    className={`group relative overflow-hidden rounded-xl border transition-colors ${
                      isSelected
                        ? "border-[#FFC800]/80 bg-[#161616]"
                        : "border-[#292929] bg-[#101010] hover:border-zinc-700"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleSelect(clip.id)}
                      className="block w-full text-left"
                    >
                      <div className="relative aspect-video bg-zinc-900">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/library/${clip.id}?thumb=1`}
                          alt={clip.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-mono text-zinc-200">
                          {fmtClipTime(clip.durationSeconds)}
                        </span>
                        <span
                          className={`absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                            isSelected
                              ? "border-[#FFC800] bg-[#FFC800] text-black"
                              : "border-zinc-500 bg-black/50 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </div>
                      <div className="px-3 py-2.5">
                        <p className="truncate text-xs font-medium text-zinc-200">{clip.name}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {clip.tags.length > 0 ? (
                            clip.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                              >
                                {tag}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-zinc-600">no tags</span>
                          )}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeClip(clip.id)}
                      disabled={deletingId === clip.id}
                      title="Remove from library"
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-zinc-400 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                    >
                      {deletingId === clip.id ? "…" : "✕"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {clips.length > 0 && selectedCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onGoRecreate}
            className="rounded-full bg-[#FFC800] px-7 py-2.5 text-sm font-semibold text-black hover:bg-[#D99A00] shadow-md transition-all"
          >
            Recreate a Reel with {selectedCount} clip{selectedCount === 1 ? "" : "s"} →
          </button>
        </div>
      )}

      <p className="text-[11px] text-zinc-600 text-center">
        Clips are stored locally on this machine and are only used to build your recreations.
      </p>
    </div>
  );
}
