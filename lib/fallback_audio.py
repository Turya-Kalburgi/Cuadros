import json, os, sys
import numpy as np

RATE = 22050
DURATION = 40.0
NAMES = ["cozy-lofi", "warm-piano", "cinematic-pad", "upbeat-groove", "calm-ambient", "night-rain"]


def add_pad(buf, start, length, freqs, amp=0.12):
    n = min(int(length * RATE), len(buf) - start)
    if n <= 0:
        return
    t = np.arange(n) / RATE
    env = np.clip(np.minimum(1, t / 0.5) * np.minimum(1, (length - t) / 0.8), 0, 1)
    wave = np.zeros(n)
    for i, freq in enumerate(freqs):
        wave += np.sin(2 * np.pi * freq * t + 0.4 * i)
    buf[start:start + n] += amp * env * wave / max(1, len(freqs))


def add_note(buf, start, freq, length, amp=0.09):
    n = min(int(length * RATE), len(buf) - start)
    if n <= 0:
        return
    t = np.arange(n) / RATE
    env = np.exp(-3.5 * t / length) * np.clip(t / 0.008, 0, 1)
    buf[start:start + n] += amp * env * np.sin(2 * np.pi * freq * t)


def add_kick(buf, start, amp=0.32):
    n = min(int(0.2 * RATE), len(buf) - start)
    if n <= 0:
        return
    t = np.arange(n) / RATE
    freq = 130 * np.exp(-20 * t) + 48
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    buf[start:start + n] += amp * np.exp(-11 * t) * np.sin(phase)


def add_hat(buf, start, rng, amp=0.045):
    n = min(int(0.06 * RATE), len(buf) - start)
    if n <= 0:
        return
    t = np.arange(n) / RATE
    buf[start:start + n] += amp * np.exp(-55 * t) * rng.normal(0, 1, n)


def finalize(buf, rng, rain=False):
    total = len(buf)
    stereo = np.stack([buf, np.roll(buf, int(0.007 * RATE))], axis=1)
    if rain:
        noise = rng.normal(0, 1, (total, 2))
        window = 12
        soft = np.convolve(noise[:, 0], np.ones(window) / window, mode="same")
        stereo[:, 0] += soft * 0.02
        stereo[:, 1] += np.roll(soft, 5) * 0.02
    peak = float(np.max(np.abs(stereo))) or 1.0
    stereo = stereo / peak * 0.38
    fade = int(0.6 * RATE)
    stereo[:fade] *= np.linspace(0, 1, fade)[:, None]
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return (stereo * 32767).astype(np.int16)


def build(name, rng):
    buf = np.zeros(int(DURATION * RATE))
    if name == "cozy-lofi":
        chords = [(261.63, 329.63, 392.0, 493.88), (220.0, 277.18, 329.63, 415.3), (174.61, 220.0, 261.63, 329.63)]
        for i in range(12):
            start = int(i * 3.2 * RATE)
            chord = chords[i % len(chords)]
            add_pad(buf, start, 3.5, chord, 0.15)
            for j in range(4):
                add_note(buf, start + int(j * 0.8 * RATE), chord[j % 4] * 2, 0.7, 0.05)
        return finalize(buf, rng, rain=True)
    if name == "warm-piano":
        chords = [(261.63, 329.63, 392.0), (293.66, 369.99, 440.0), (349.23, 440.0, 523.25)]
        for i in range(16):
            start = int(i * 2.4 * RATE)
            chord = chords[i % len(chords)]
            for j, freq in enumerate(chord):
                add_note(buf, start + int(j * 0.32 * RATE), freq, 1.8, 0.16)
            add_note(buf, start + int(1.4 * RATE), chord[0] / 2, 1.0, 0.08)
        return finalize(buf, rng)
    if name == "cinematic-pad":
        roots = [110.0, 130.81, 146.83, 98.0]
        for i in range(8):
            start = int(i * 5 * RATE)
            root = roots[i % len(roots)]
            add_pad(buf, start, 5.5, [root, root * 1.5, root * 2, root * 2.5], 0.18)
            add_pad(buf, start, 5.5, [root * 1.002, root * 2.003], 0.1)
        return finalize(buf, rng)
    if name == "upbeat-groove":
        for beat in range(int(DURATION / 0.5)):
            start = int(beat * 0.5 * RATE)
            if beat % 4 in (0, 2):
                add_kick(buf, start)
            add_hat(buf, start + int(0.25 * RATE), rng, 0.035 if beat % 4 else 0.06)
            bass = [82.41, 98.0, 110.0, 73.42][(beat // 4) % 4]
            add_note(buf, start, bass, 0.4, 0.12)
        return finalize(buf, rng)
    if name == "calm-ambient":
        for i in range(5):
            start = int(i * 8 * RATE)
            add_pad(buf, start, 8.5, [174.61, 261.63, 349.23, 523.25], 0.14)
        return finalize(buf, rng, rain=True)
    for i in range(10):
        start = int(i * 4 * RATE)
        add_pad(buf, start, 4.5, [196.0, 246.94, 293.66], 0.13)
        add_note(buf, start + int(2 * RATE), 392.0, 1.2, 0.05)
    return finalize(buf, rng, rain=True)


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for i, name in enumerate(NAMES):
        target = os.path.join(out_dir, f"{name}.wav")
        if os.path.exists(target) and os.path.getsize(target) > 100000:
            made.append(target)
            continue
        rng = np.random.default_rng(1000 + i)
        audio = build(name, rng)
        with __import__("wave").open(target, "wb") as handle:
            handle.setnchannels(2)
            handle.setsampwidth(2)
            handle.setframerate(RATE)
            handle.writeframes(audio.tobytes())
        made.append(target)
    print(json.dumps(made))


main()
