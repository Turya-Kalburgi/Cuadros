# cuadros

> **One studio. Every video workflow.**  
> Website: [cuadros.ai](https://cuadros.ai)

cuadros is an AI-powered video creation and editing studio where creators can generate videos from ideas, edit their own footage, recreate reference-video editing styles, and produce publish-ready cinematic content.

---

## 5 Core Workflows

1. **Edit My Footage**: Upload multiple clips or import video links, analyze moments and dialogue, trim on a precision timeline, reframe to vertical 9:16, add synced music, and export.
2. **Generate a Video**: Transform prompts and scripts into a shotlist and rendered 9:16 scenes with custom visual styles, burned captions, synthesized ambient audio, and optional local-voice narration (macOS `say`; gracefully skipped when unavailable). Visuals are generated procedurally with FFmpeg — no cloud video or image model is required, and an OpenAI/Gemini key improves the shotlist when present.
3. **Recreate a Reference Video**: Analyze the editing style, cut pacing, zoom rhythm, captions, and soundtrack of any inspiration video, then map your footage onto that creative blueprint.
4. **Create Using Both**: Seamlessly combine your original footage, AI-generated scenes, and reference-inspired pacing within a unified project workspace.
5. **Auto AI Clips**: Paste a long video link and get finished, music-driven reels. Choose **Clean single shot** (calm ~20s shots like an aesthetic routine reel) or **Fast cuts**, aspect ratio, look and a trending song. You can also **Load timeline** to see frames from the whole video, pick the exact ones you like, and get one reel per pick. Face/phone rejection, frame-quality ranking, beat-synced cuts and minimal burned text are built in. Local storage by default; optional Bunny cloud sync via environment variables.

---

## Architecture & Principles

- **Frontend**: Next.js (App Router), React 19, TypeScript, Tailwind CSS with cuadros cinematic palette (`#080808` background, `#FFC800` primary accent, `#191919` surface, `#292929` borders).
- **Processing**: Local deterministic FFmpeg / FFprobe media pipelines with Apple Silicon hardware acceleration (`h264_videotoolbox`), background job queues, and atomic JSON persistence.
- **Intelligence**: Multimodal model adapters (OpenAI / Gemini) with graceful heuristic fallbacks for offline editing.
- **Audio & Subtitles**: YouTube & `yt-dlp` track search, synced lyrics via `lrclib`, beat detection, and burnt-in/SRT caption generation.

---

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

Open [http://localhost:3000](http://localhost:3000) to open the cuadros studio.
