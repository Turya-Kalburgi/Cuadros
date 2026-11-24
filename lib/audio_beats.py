import argparse, json, subprocess
import numpy as np
from scipy.signal import find_peaks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    args = parser.parse_args()
    result = {"interval": None, "bpm": None, "phase": 0.0, "onsets": []}

    try:
        proc = subprocess.run(
            [
                "ffmpeg", "-v", "error", "-i", args.audio,
                "-ac", "1", "-ar", "11025", "-f", "s16le", "-",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=90,
        )
        rate = 11025
        hop = 256
        samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
        frames = len(samples) // hop
        if frames < 32:
            raise ValueError("audio too short")
        matrix = samples[: frames * hop].reshape(frames, hop)
        spectrum = np.abs(np.fft.rfft(matrix, axis=1))
        flux = np.maximum(0, np.diff(spectrum, axis=0)).sum(axis=1)
        flux = flux - np.convolve(flux, np.ones(10) / 10, mode="same")
        flux = np.maximum(flux, 0)

        peaks, _ = find_peaks(
            flux,
            distance=int(0.22 * rate / hop),
            prominence=float(np.percentile(flux, 70)),
        )
        onsets = [float(p * hop / rate) for p in peaks]

        centered = flux - flux.mean()
        corr = np.correlate(centered, centered, mode="full")[len(centered) - 1 :]
        low = max(1, int(60 / 180 * rate / hop))
        high = min(len(corr) - 1, int(60 / 60 * rate / hop))
        lag = low + int(np.argmax(corr[low:high]))
        interval = lag * hop / rate
        if not 0.25 <= interval <= 1.2:
            raise ValueError("no stable tempo")

        best_phase = 0.0
        best_score = -1
        for phase in np.linspace(0, interval, 24, endpoint=False):
            score = sum(
                1
                for t in onsets
                if abs(((t - phase + interval / 2) % interval) - interval / 2) < 0.09
            )
            if score > best_score:
                best_score = score
                best_phase = float(phase)

        result = {
            "interval": round(interval, 4),
            "bpm": round(60 / interval, 1),
            "phase": round(best_phase, 4),
            "onsets": [round(t, 3) for t in onsets[:240]],
        }
    except Exception as exc:
        result["error"] = str(exc)

    print(json.dumps(result))


main()
