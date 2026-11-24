import { execFile } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { PROJECT_ROOT, readJson, STORAGE_ROOT } from "./paths";
import type { ClipRange } from "./types";

const execFileAsync = promisify(execFile);
const MODELS_DIR = path.join(STORAGE_ROOT, "models");
const SCRIPT = path.join(PROJECT_ROOT, "lib", "face_diversity.py");
const MODELS = [
  {
    name: "yunet.onnx",
    url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
  },
  {
    name: "sface.onnx",
    url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
  },
  {
    name: "ssd-mobilenet-v2-coco.onnx",
    url: "https://huggingface.co/opencv/opencv_contribution/resolve/refs%2Fpr%2F14/ssd_mobilenet_v2_coco_2018_03_29/ssd_mobilenet_v2_coco_2018_03_29_2026jul.onnx",
  },
];

export type FaceShotInfo = {
  ids: number[];
  hash: string;
  kind?: "close" | "wide" | "active" | "detail";
  faceless?: boolean;
  motion?: number;
  edge?: number;
  faceSize?: number;
  phone?: boolean;
  people?: number;
  sharp?: number;
  bright?: number;
  contrast?: number;
  otherFaces?: boolean;
  mainFace?: boolean;
  faceBright?: number;
  faceMin?: number;
  color?: number[];
};

export type FaceAnalysis = {
  dominant: number | null;
  identities: Record<string, number>;
  shots: FaceShotInfo[];
  error?: string;
};

async function ensureModels(): Promise<boolean> {
  try {
    await fs.mkdir(MODELS_DIR, { recursive: true });
  } catch {
    return false;
  }
  for (const model of MODELS) {
    const target = path.join(MODELS_DIR, model.name);
    try {
      if ((await fs.stat(target)).size > 1000) continue;
    } catch {
      /* download below */
    }
    try {
      await execFileAsync(
        "curl",
        ["-L", "--fail", "--max-time", "120", "-o", target, model.url],
        { timeout: 130000 },
      );
    } catch {
      return false;
    }
  }
  return true;
}

export async function analyzeFaces(
  videoFile: string,
  ranges: ClipRange[],
): Promise<FaceAnalysis | null> {
  if (ranges.length === 0) return null;
  if (!(await ensureModels())) return null;
  const signature = JSON.stringify(ranges.map((range) => [range.start, range.end]));
  const stat = await fs.stat(videoFile).catch(() => null);
  const key = createHash("sha1")
    .update(`${videoFile}:${stat?.size ?? 0}:${stat?.mtimeMs ?? 0}:${signature}`)
    .digest("hex");
  const cacheFile = path.join(STORAGE_ROOT, "cache", `faces-${key}.json`);
  try {
    const cached = await readJson<FaceAnalysis>(cacheFile);
    if (cached && cached.shots?.length === ranges.length) return cached;
  } catch {
    /* cache miss */
  }
  try {
    const { stdout } = await execFileAsync(
      "python3",
      [
        SCRIPT,
        "--video",
        videoFile,
        "--models",
        MODELS_DIR,
        "--shots",
        JSON.stringify(ranges.map((r) => ({ start: r.start, end: r.end }))),
        "--frames",
        "2",
      ],
      { timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as FaceAnalysis;
    if (Array.isArray(parsed.shots)) {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(parsed), "utf8").catch(() => undefined);
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) distance++;
  return distance;
}
