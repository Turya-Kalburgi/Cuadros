# FrameMuse

AI-assisted cinematic video repurposing & reel recreation studio that transforms footage into vertical 9:16 stories with beat-synced edits and inspired audio.

## Features

- **Timeline Studio**: Visual timeline editor with scrubbable playhead, draggable range selection, split/trim controls, and thumbnail previews.
- **Inspired Reel Matcher**: Recreate 30–40s vertical reels by matching cut pacing, rhythm, and soundtrack from an inspiration video.
- **Multi-Clip & Link Ingestion**: Batch upload local video files or paste video URLs with multi-clip combination.
- **Soundtrack & Synchronized Lyrics**: Search music via YouTube/yt-dlp, sync lyrics via lrclib, trim song parts, and mix/replace audio.
- **Fast Media Pipeline**: Hardware-accelerated video scaling, reframing (9:16 vertical, 16:9 horizontal, letterbox fit), and high-quality rendering via FFmpeg.
- **Captions & Recreate Engine**: Caption generation and stylistic recreation workflows.

## Getting Started

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [FFmpeg](https://ffmpeg.org/) (`brew install ffmpeg`)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (`brew install yt-dlp`)

### Run Development Server

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start creating reels.
