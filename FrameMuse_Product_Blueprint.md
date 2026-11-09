# FrameMuse --- AI Cinematic Reel Studio

> **Working name:** FrameMuse\
> **Tagline:** Turn long videos into stories worth watching.\
> **Product type:** AI-assisted video repurposing and cinematic editing\
> **Initial goal:** Build a personal tool for creating cinematic
> Instagram Reels, then expand for other video creators.

> **Naming note:** FrameMuse is a working name, not a trademark or
> domain clearance. Check domain, social-handle, and trademark
> availability before committing to it.

------------------------------------------------------------------------

## 1. Product vision

FrameMuse turns a long video into several short, vertical, cinematic
edits based on the creator's instructions. Instead of automatically
cutting only for virality, it aims to preserve story, mood, composition,
pacing, and natural audio.

**Core workflow**

1.  Upload a video or provide a supported, authorized source link.
2.  Describe the desired edit in natural language.
3.  Analyze scenes, dialogue, audio, and visual moments.
4.  Generate multiple editable Reel drafts.
5.  Preview, adjust, and export the selected edit.

**Example prompt**

> Turn my 20-minute college vlog into three 30-second Reels. Make them
> cinematic, slightly warm, emotional but not cringe. Use my best shots,
> natural audio, smooth cuts, and no flashy transitions. Give each Reel
> a different story.

## 2. Product principles

-   **Taste over virality:** prioritize composition, emotion, story, and
    pacing.
-   **AI proposes; creator decides:** generated edits are drafts that
    users can review.
-   **Nondestructive editing:** keep original media unchanged and store
    edit decisions separately.
-   **Repeatable style:** save preferences for color, pacing, captions,
    transitions, and audio.
-   **Reproducible rendering:** a validated edit plan is rendered by a
    deterministic media pipeline.
-   **Respect rights:** process media the user owns or is authorized to
    use.

## 3. MVP scope

### Must have

-   Upload a video from the user's device.
-   Inspect media duration, dimensions, frame rate, and audio streams.
-   Generate scene boundaries and thumbnail contact sheets.
-   Transcribe speech with timestamps.
-   Identify candidate moments and rank them.
-   Generate three edit plans with different story angles.
-   Export vertical 9:16 MP4 drafts.
-   Support basic crop positioning and conservative cinematic color
    presets.
-   Preserve original audio and optionally accept user-provided music.
-   Provide a draft gallery, preview, trim, reorder, replace-clip, and
    export controls.
-   Save projects, draft versions, and rendering status.

### Defer until later

-   Full professional editing timeline.
-   Automatic publishing to social platforms.
-   Training a custom foundation model.
-   Generative video that invents new footage.
-   Complex team collaboration, agency billing, and a large licensed
    music library.
-   Large catalog of elaborate transitions.

### First success criteria

-   A user can upload a video and export a valid vertical clip.
-   One source can produce three distinct, playable drafts.
-   The creator can fix a draft without rebuilding the entire project.
-   On a small personal test set, drafts save meaningful editing time
    and are worth keeping.

## 4. Recommended architecture

Start with a **modular monolith plus a separate background worker**.
Avoid microservices for the first version.

``` text
Browser / Creator Dashboard
        |
        v
Next.js + TypeScript API
        |
        +------ PostgreSQL (projects, assets, edit plans, jobs)
        |
        +------ Object Storage (source media, proxies, exports)
        |
        v
Analysis and Edit-Planning Pipeline
  - FFprobe metadata inspection
  - Scene detection and thumbnails
  - Speech transcription
  - Candidate-moment scoring
  - Story and edit-plan generation
        |
        v
Background Render Worker
  - FFmpeg cutting and sequencing
  - 9:16 reframing
  - Color and audio processing
  - Captions and encoding
        |
        v
Draft Gallery / Review Editor / Export
```

### Suggested stack

  -----------------------------------------------------------------------
  Layer                   Initial choice          Purpose
  ----------------------- ----------------------- -----------------------
  Frontend and API        Next.js, TypeScript,    Dashboard and
                          Tailwind CSS            application API

  Database                PostgreSQL with Prisma  Project and job
                          or Drizzle              persistence

  Media inspection        FFprobe                 Read media metadata

  Media processing        FFmpeg                  Cut, crop, encode, mix
                                                  audio, captions

  AI planner              Multimodal model +      Analyze evidence and
                          speech transcription    create edit plans

  Queue                   A simple                Background work and
                          database-backed queue   retries
                          initially; Redis +      
                          BullMQ when needed      

  Storage                 Local disk during       Large media and exports
                          development;            
                          S3-compatible object    
                          storage later           

  Worker                  Separate Node.js        Run long video jobs
                          process                 outside HTTP requests
  -----------------------------------------------------------------------

## 5. AI and video pipeline

1.  **Ingest:** validate file type, size, duration, and streams.
2.  **Inspect:** use FFprobe to read video and audio metadata.
3.  **Analyze scenes:** detect shot boundaries and create representative
    thumbnails.
4.  **Transcribe:** obtain timestamped speech and, where useful,
    identify pauses.
5.  **Rank moments:** score composition, story relevance, audio
    usefulness, technical quality, and variety.
6.  **Plan stories:** choose complementary moments and sequence them
    into different edits.
7.  **Validate plan:** check timestamps, source bounds, duration, crop
    instructions, and supported effects.
8.  **Render:** use FFmpeg to cut, reframe, grade, mix audio, add
    captions, and encode.
9.  **Review:** show drafts and support trim, reorder, replace, crop,
    and regeneration.
10. **Learn from corrections:** record which clips the creator keeps,
    removes, or adjusts.

### Starting moment-ranking heuristic

These are initial weights to test, not validated model truths:

-   Visual composition and shot quality: 30%
-   Story or emotional relevance: 25%
-   Audio and dialogue usefulness: 20%
-   Variety across shots: 15%
-   Technical quality: 10%

Tune the weights using real edits and creator feedback. Do not let an
LLM invent timestamps: it should choose from timestamped media evidence.

## 6. Edit-plan format

The AI should output structured instructions, not a finished video.
Example:

``` json
{
  "title": "A day I want to remember",
  "aspectRatio": "9:16",
  "durationSeconds": 30,
  "style": "cinematic-warm",
  "clips": [
    {
      "sourceStart": 12.4,
      "sourceEnd": 16.1,
      "purpose": "opening visual",
      "crop": "subject-tracking",
      "transition": "cut"
    },
    {
      "sourceStart": 84.0,
      "sourceEnd": 90.5,
      "purpose": "personal story",
      "crop": "center",
      "transition": "dissolve"
    }
  ],
  "audio": {
    "preserveOriginal": true,
    "music": "optional-user-supplied-track"
  }
}
```

This is illustrative, not a production schema. Validate every timestamp
against the source duration, resolve crop modes to real coordinates, and
reject unsupported effects before rendering.

## 7. Data model

  -----------------------------------------------------------------------
  Table                               Main purpose
  ----------------------------------- -----------------------------------
  `projects`                          Name, prompt, target duration,
                                      style, timestamps

  `assets`                            Source path, duration, dimensions,
                                      frame rate, status

  `scenes`                            Time ranges, thumbnails, transcript
                                      segments, scene metadata

  `edit_drafts`                       Draft title, version, serialized
                                      edit plan, status

  `render_jobs`                       Queue state, progress, retries,
                                      errors, output path

  `style_presets`                     Color, pacing, caption, transition,
                                      and audio preferences
  -----------------------------------------------------------------------

For the first version, support one source asset per project and multiple
drafts. Keep the model extensible for multi-asset projects later.

## 8. Suggested API routes

``` text
POST   /api/projects
POST   /api/projects/:id/assets
POST   /api/projects/:id/analyze
POST   /api/projects/:id/drafts
GET    /api/projects/:id/jobs/:jobId
PATCH  /api/drafts/:id/edit-plan
POST   /api/drafts/:id/render
GET    /api/drafts/:id
```

Use presigned storage URLs for large uploads once cloud storage is
introduced. Persist job state so server restarts do not lose progress.

## 9. Source-link and copyright constraints

Direct upload should be the primary MVP path. A public YouTube URL does
not automatically grant permission to download the audiovisual file.
YouTube API access and metadata access do not themselves provide a
general download license.

For link import: - Use a documented, authorized import mechanism. - Only
process content when the user has the necessary rights and the source
terms permit it. - Do not build the product around bypassing platform
restrictions. - If direct import is not permitted, ask the creator to
upload their original file or use another authorized source.

## 10. Costs and operating assumptions

Costs depend on video length, resolution, AI model, number of revisions,
storage, and rendering hardware. Treat the following as planning
guidance, not a quote.

### Keep the first prototype inexpensive

-   Render locally with FFmpeg on the developer's computer.
-   Use low-resolution proxies for analysis.
-   Cache transcripts, thumbnails, and scene analysis when the source
    has not changed.
-   Render only after a draft is approved, and rerender only affected
    parts where practical.
-   Begin with a small number of AI calls and measure actual cost per
    finished Reel.

### Cost categories

  -----------------------------------------------------------------------
  Cost                    What drives it          Cost-control approach
  ----------------------- ----------------------- -----------------------
  AI analysis             Frames, transcript      Sample frames
                          length, model choice    selectively; cache
                                                  analysis

  Transcription           Audio duration and      Benchmark local and
                          provider rate           hosted options

  Rendering               Duration, resolution,   Local worker first; use
                          codec, CPU/GPU          proxies

  Storage                 Source size, exports,   Delete temporary files;
                          retention period        offer cleanup

  Hosting                 Requests and job        Keep rendering off
                          coordination            serverless request
                                                  handlers

  Music licensing         Track catalog and usage Begin with
                          rights                  user-provided licensed
                                                  music
  -----------------------------------------------------------------------

A local-first prototype can have very low incremental costs, but
production costs should be measured with representative files before
pricing the product.

## 11. Six-week build roadmap

Assumption: approximately 2--4 focused hours per day, with a
personal-use prototype as the goal.

### Week 1 --- Ingest and render

-   Set up the Next.js project and upload page.
-   Run FFprobe to inspect media.
-   Use FFmpeg to cut a time range and export a vertical MP4.
-   Test on three different source videos.

**Done when:** a user can upload a video and export a vertical clip.

### Week 2 --- Scene analysis

-   Detect scene boundaries.
-   Extract thumbnails and generate a contact sheet.
-   Add timestamped transcription.
-   Store analysis results in PostgreSQL.

**Done when:** the source can be inspected as a searchable set of scenes
and dialogue.

### Week 3 --- AI edit planner

-   Define and validate the edit-plan schema.
-   Rank candidate moments and remove duplicates.
-   Generate three distinct sequences.
-   Check timestamps and duration limits.

**Done when:** one source produces three valid editing plans.

### Week 4 --- Cinematic rendering

-   Implement 9:16 cropping and crop positioning.
-   Add conservative color presets.
-   Preserve original audio and support optional user-provided music.
-   Add captions and render error handling.

**Done when:** edit plans render into playable cinematic drafts.

### Week 5 --- Review editor

-   Build the draft gallery and preview player.
-   Add trim, reorder, replace-clip, and crop controls.
-   Support prompt-based regeneration.
-   Save edit-plan versions.

**Done when:** a draft can be refined without restarting the whole
pipeline.

### Week 6 --- Personal testing

-   Test on five of your own videos.
-   Compare generated drafts with your manual edits.
-   Fix awkward cuts, poor crops, and audio issues.
-   Add export settings and project cleanup.

**Done when:** you can use the product in your own real content
workflow.

## 12. Quality metrics

Track these before adding more features:

-   **Keep rate:** percentage of generated drafts the creator would
    publish.
-   **Time saved:** manual editing time versus AI-assisted time.
-   **Correction rate:** number of cuts or crops the creator has to fix.
-   **Visual quality:** correct subject framing and intentional shot
    choices.
-   **Story quality:** whether the edit feels coherent rather than like
    a random montage.
-   **Reliability:** successful renders divided by render attempts.
-   **Cost per accepted Reel:** AI, compute, and storage cost for a
    draft the creator keeps.

Maintain a small evaluation set containing source videos, generated
drafts, final selected edits, and corrections. This becomes your
feedback dataset.

## 13. First engineering milestone

Do not build the whole system at once. First prove this vertical slice:

1.  Upload one MP4.
2.  Read its duration and generate thumbnails.
3.  Select three time ranges.
4.  Cut and combine those ranges with FFmpeg.
5.  Export a vertical MP4.
6.  Play and download the result from the website.

Then add transcription, AI scene selection, and automatic planning.

## 14. Naming and positioning

**Recommended working name: FrameMuse**

-   **Frame** suggests visual composition and filmmaking.
-   **Muse** suggests creative inspiration rather than generic
    automation.
-   The name can stretch from cinematic Reels to other creator video
    workflows.

**Tagline:** Turn long videos into stories worth watching.

Alternative names: - **ReelSmith** --- emphasizes crafting and editing
Reels. - **Cutscene AI** --- emphasizes story-driven cuts; check for
existing uses. - **FrameFlow** --- emphasizes a smooth editing
workflow. - **StorySplice** --- emphasizes joining moments into a
narrative. - **CineShorts** --- communicates cinematic short-form video
directly.

Before using any name publicly, check domain availability, social
handles, relevant trademark databases, and existing products. These
suggestions have not been cleared.

------------------------------------------------------------------------

## Immediate next step

Build the upload-to-vertical-export slice first. Once it works reliably,
add scene analysis and the edit planner. The product's differentiator
should be the quality and controllability of its edits, not simply the
number of clips it generates.


impement this
