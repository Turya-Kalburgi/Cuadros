import json, subprocess, sys
import cv2
import numpy as np

video = sys.argv[1]

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", video],
    capture_output=True,
    text=True,
)
duration = float(json.loads(probe.stdout)["format"]["duration"])

scan = subprocess.run(
    [
        "ffmpeg", "-v", "error", "-i", video,
        "-vf", "select='gt(scene,0.2)',metadata=print:key=lavfi.scene_score",
        "-an", "-f", "null", "-",
    ],
    capture_output=True,
    text=True,
)
cuts = []
at = None
for line in scan.stderr.splitlines():
    match = __import__("re").search(r"pts_time:([\d.]+)", line)
    if match:
        at = float(match.group(1))
    score = __import__("re").search(r"lavfi\.scene_score=([\d.]+)", line)
    if score and at is not None:
        cuts.append(round(at, 2))
        at = None

bounds = [0.0] + cuts + [duration]
shots = [round(bounds[i + 1] - bounds[i], 2) for i in range(len(bounds) - 1)]

audio = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", video, "-ac", "1", "-ar", "11025", "-f", "s16le", "-"],
    capture_output=True,
)
samples = np.frombuffer(audio.stdout, dtype=np.int16).astype(np.float32) / 32768.0
bpm = None
if len(samples) > 11025:
    hop = 256
    frames = len(samples) // hop
    matrix = samples[: frames * hop].reshape(frames, hop)
    spec = np.abs(np.fft.rfft(matrix, axis=1))
    flux = np.maximum(0, np.diff(spec, axis=0)).sum(axis=1)
    centered = flux - flux.mean()
    corr = np.correlate(centered, centered, mode="full")[len(centered) - 1 :]
    low = int(60 / 180 * 11025 / hop)
    high = min(len(corr) - 1, int(60 / 60 * 11025 / hop))
    lag = low + int(np.argmax(corr[low:high]))
    bpm = round(60 / (lag * hop / 11025), 1)

cap = cv2.VideoCapture(video)
frames = []
for i in range(8):
    cap.set(cv2.CAP_PROP_POS_MSEC, duration * 1000 * (i + 0.5) / 8)
    ok, frame = cap.read()
    if not ok:
        continue
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    frames.append({
        "bright": round(float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean()), 1),
        "sat": round(float(hsv[:, :, 1].mean()), 1),
        "color": [round(float(v), 1) for v in cv2.mean(frame)[:3]],
    })
cap.release()

print(json.dumps({
    "duration": round(duration, 2),
    "cuts": len(cuts),
    "cutTimes": cuts,
    "shotLengths": shots,
    "medianShot": round(float(np.median(shots)), 2) if shots else None,
    "bpm": bpm,
    "frames": frames,
}))
