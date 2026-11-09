# aiditor — Product Specification

## 1. Product Overview

aiditor is an open-source, local-first, AI-native desktop video editor.

The name is intentionally lowercase:

> aiditor = AI + editor

aiditor is designed for modern content creators making:

- YouTube videos
- YouTube Shorts
- Instagram Reels
- TikTok videos
- Other short-form and long-form internet content

The goal is not to reproduce a traditional professional film-editing application.

The goal is to build an editor optimized for the way modern creators actually create content, while making the entire editor understandable and controllable by AI agents.

---

# 2. Core Product Vision

aiditor should allow a human and an AI agent to work on the exact same project.

A human should be able to manually edit the timeline.

An AI agent should be able to inspect the project, understand the timeline, and perform edits.

Both must operate through the same underlying editor system.

```text
                    HUMAN
                      │
                      ▼
                 Editor UI
                      │
                      ▼
                Editor Commands
                      │
                      ▼
                ProjectState
                      │
            ┌─────────┴─────────┐
            ▼                   ▼
         Preview             Renderer


                    AI AGENT
                      │
                      ▼
                     MCP
                      │
                      ▼
                Editor Commands
                      │
                      ▼
                ProjectState
```

The AI should not generate a finished MP4 and pretend that the MP4 is the project.

The AI should manipulate the actual editable project.

---

# 3. Most Important Architectural Rule: Project-First Architecture

## ProjectState is the single source of truth.

aiditor must ALWAYS operate within a ProjectState.

There must never be a separate "AI editing state", "temporary AI timeline", or AI-only editing model that bypasses ProjectState.

Both humans and AI are clients of the same project system:

```text
Human
  ↓
Editor UI
  ↓
Editor Commands
  ↓
ProjectState

AI
  ↓
AI Agent / MCP
  ↓
Editor Commands
  ↓
ProjectState
```

Therefore:

> No editing operation can happen without a ProjectState.

Nothing else is the authoritative representation of the project.

The following must NOT become the source of truth:

- rendered MP4 files
- FFmpeg commands
- preview output
- React component state
- UI state
- AI-generated video files
- temporary render files

The project should always be reconstructable from ProjectState.

---

# 4. Product Philosophy

aiditor should prioritize:

1. Simplicity
2. Speed
3. Creator-focused workflows
4. AI-native operation
5. Local processing
6. Open-source technologies
7. Non-destructive editing
8. Deterministic editing operations
9. Extensibility
10. Human + AI interoperability

aiditor does NOT need to initially compete with DaVinci Resolve or Premiere in every professional feature.

The target is:

> A powerful creator editor that an AI can actually understand and operate.

---

# 5. Target Users

Primary users:

- YouTube creators
- Shorts creators
- Instagram creators
- TikTok creators
- Solo creators
- AI-assisted creators
- Content teams
- Developers building AI editing agents

Secondary users:

- Video editors
- Automation developers
- AI researchers
- Open-source contributors

---

# 6. Core Editing Workflow & Project-First Lifecycle

aiditor enforces a strict **Project-First Architecture**: no editing operation (human or AI) can execute without an initialized `ProjectState`.

```text
Human                                         AI Agent
  ↓                                              ↓
Start / Welcome Screen                         User Instruction
  │                                              │
  ├── Create New Project                         ├── Uses Existing ProjectState (if open)
  ├── Open Existing Project (.aiditor)           └── Or Establishes ProjectState first
  ├── Open Recent Project                                │
  ├── Continue Unsaved / Recovered                       ▼
  └── Load Demo Project                            Editor Commands
          ↓                                              ↓
    ProjectState ◄───────────────────────────────────────┘
          │
  ┌───────┴───────┐
  ▼               ▼
Preview        Renderer (derived from ProjectState)
```

---

## 6.1 Human Project Creation

On application launch, the user is presented with a clear Welcome / Start screen providing:

- **Create New Project**
- **Open Existing Project** (native file dialog for `.aiditor` files)
- **Open Recent Project** (list of recently opened project paths)
- **Continue Unsaved / Recovered Project** (when application recovery data exists)
- **Load Demo Project** (pre-populated with sample clips and tracks)

When creating a new project, the user can configure:

1. **Project Name**: Text identifier (e.g. "My First Video", "FIFA Coke").
2. **Resolution / Canvas Preset**:
   - Horizontal: `1920 × 1080` (16:9, YouTube landscape)
   - Vertical: `1080 × 1920` (9:16, YouTube Shorts, Reels, TikTok)
   - Square: `1080 × 1080` (1:1, Instagram square)
   - Custom: configurable width and height in pixels
3. **Frame Rate (FPS)**:
   - `24 FPS` (cinematic)
   - `25 FPS` (PAL standard)
   - `30 FPS` (standard web / mobile video)
   - `50 FPS` (high framerate PAL)
   - `60 FPS` (high framerate / gaming)
   - Custom FPS
4. **Audio Sample Rate**:
   - `48,000 Hz` (default professional video standard)
   - Configurable (e.g., `44,100 Hz`) where practical

When the project is created:
- A real `ProjectState` instance is instantiated.
- All configuration is saved directly into `ProjectState.settings` (`width`, `height`, `fps`, `sampleRate`).
- Default tracks are created: `track-v1` ("Video 1", video) and `track-a1` ("Audio 1", audio).
- `playheadTime` is set to `0`.
- `selectedItemId` is set to `null`.
- The application enters the editor layout.

Project configuration must **NOT** exist solely inside React component state; it resides within `ProjectState`.

---

## 6.2 AI Project Creation

AI agents (via MCP or internal prompts) must follow the exact same project lifecycle:

1. **If a project already exists**:
   - The AI must use the existing `ProjectState` and respect its canvas resolution, framerate, and settings.
   - Example: If the project is `1920 × 1080 @ 24fps`, a request like `"Make this into a 30 second Short"` must operate within the current project unless the user explicitly requests changing the canvas/project settings.
2. **If NO project exists**:
   - The AI must first establish a real `ProjectState` before performing any timeline or media editing operations.
   - Example: User asks `"Make a 30 second vertical Short from these clips"`. The AI infers/recommends `1080 × 1920`, `30 FPS`, `48,000 Hz`, creates the `ProjectState`, and then adds the assets and clips.
3. **No Parallel AI Timeline**:
   - The AI must **never** build a separate internal timeline or generate an uneditable MP4 and present it as the result.
   - The `ProjectState` itself is the AI's editing context.

---

## 6.3 AI Project-Setting Recommendations & Precedence Hierarchy

When the user gives incomplete or underspecified project settings, the AI selects sensible defaults based on the target content:

- **Short / Reel / TikTok**: `1080 × 1920` (9:16)
- **YouTube landscape**: `1920 × 1080` (16:9)
- **Square content**: `1080 × 1080` (1:1)
- **Default Frame Rate**: `30 FPS`
- **Default Audio Sample Rate**: `48,000 Hz`

### Precedence Hierarchy:
```text
Explicit User Settings
       >
Existing Project Settings (when user explicitly requests a project modification)
       >
AI Recommendations / Defaults
```

AI must never silently override explicit user requirements.

---

## 6.4 Temporary & Unsaved Projects

A project does **NOT** need to be immediately saved to a user-selected path before editing can begin. New projects can start immediately as temporary/unsaved projects.

aiditor maintains temporary project data in its application data directory:

```text
aiditor application data/
└── projects/
    └── temporary/
        ├── project state
        ├── autosave
        ├── thumbnails
        ├── proxies
        ├── waveforms
        └── generated cache
```

### The Four-Way Architectural Separation:
1. **`ProjectState`**: The in-memory data structure and single source of truth for all editing.
2. **Project File (`.aiditor`)**: The persistent serialized representation saved on disk.
3. **Source Media**: Immutable original video/audio/image files on local disk (never modified).
4. **Generated Cache / Analysis Data**: Proxies, thumbnails, waveforms, AI tracking masks, and transcripts stored in app data.

---

## 6.5 Unsaved Project Behavior & Future Recovery

An unsaved project behaves like a completely normal, first-class project:
- Import media
- Add, move, split, trim, delete clips
- Undo and redo
- Preview playback
- AI-assisted editing operations

The project is simply flagged with an `isUnsaved: true` or dirty state. The architecture is prepared for future periodic autosaving into the temporary application data directory so accidental closure does not destroy unsaved work.

---

## 6.6 Save / Save As

When the user explicitly saves a project:
1. Trigger a native save file dialog (`.aiditor`).
2. User chooses the file destination.
3. Serialize `ProjectState` to structured, versionable JSON.
4. Associate the active project with that file path.
5. Clear the unsaved status.

`ProjectState` remains independent of React UI components during serialization.

---

## 6.7 Source Media Immutability

Original source media files are strictly read-only:
- `ProjectState` holds file references and boundary markers (`path`, `sourceIn`, `sourceOut`).
- Cutting, splitting, or deleting clips never deletes or trims the actual video files on disk.
- Generated auxiliary data (waveforms, thumbnails, proxies) lives cleanly in cache directories.

---

## 6.8 Demo Project Behavior

The application provides a "Demo Project" option on the Welcome screen:
- The Demo Project instantiates a genuine `ProjectState` with pre-configured settings, sample media assets, video/audio tracks, and placed timeline items.
- It operates using the exact same `CommandHistory` and command system as user-created projects.
- There is **no fake UI-only demo state**.

---

# 7. Current Development Status

The project currently has:

- React
- TypeScript
- Vite
- Tauri
- Rust
- ProjectState
- MediaAsset model
- Track model
- TimelineItem model
- EditorCommand system
- EditorHistory
- Undo/redo
- Unit tests
- Basic build pipeline

The editor UI is the next major development phase.

---

# 8. Development Strategy

aiditor must be developed incrementally.

Do not attempt to build every feature simultaneously.

The general order should be:

```text
Editor Foundation
        ↓
Basic Timeline Editor
        ↓
Media / Preview
        ↓
Save / Load
        ↓
Real Media Processing
        ↓
Rendering
        ↓
Captions
        ↓
Audio / SFX
        ↓
Effects / Motion Graphics
        ↓
Masks / Tracking
        ↓
AI Editing
        ↓
MCP
        ↓
Advanced AI Workflows
```

---

# 9. Phase 1 — Editor Foundation

The first usable version should support:

- Create project
- ProjectState
- Save project
- Load project
- Import media
- Media metadata
- Media panel
- Timeline
- Video tracks
- Audio tracks
- Timeline clips
- Select clips
- Move clips
- Trim clips
- Split clips
- Delete clips
- Playhead
- Basic preview
- Undo
- Redo

Minimum workflow:

```text
Create Project
→ Import Video
→ Add to Timeline
→ Play
→ Move
→ Trim
→ Split
→ Delete
→ Undo
→ Redo
→ Save
→ Reopen
```

---

# 10. Phase 2 — Real Media Pipeline

Implement:

- Local media importing
- Media metadata extraction
- Video decoding
- Audio decoding
- Proxy generation
- Thumbnail generation
- Waveform generation
- Media caching

Original source files should remain untouched.

Editing should be non-destructive.

---

# 11. Phase 3 — Preview and Rendering

There should be a clear separation between:

```text
ProjectState
     ↓
Composition
     ↓
Preview
```

and:

```text
ProjectState
     ↓
Composition
     ↓
Final Renderer
     ↓
FFmpeg / encoding infrastructure
     ↓
Final Video
```

FFmpeg is infrastructure.

FFmpeg commands must not be scattered throughout the application.

Create an abstraction around media processing/rendering so the underlying implementation can evolve later.

---

# 12. Phase 4 — Creator Editing Features

Add features specifically useful for internet creators.

## Cutting

- Split
- Trim
- Ripple delete
- Delete
- Move
- Duplicate
- Replace
- Slip editing where practical

## Transform

- Position
- Scale
- Rotation
- Opacity
- Anchor point

## Animation

- Keyframes
- Position animation
- Scale animation
- Rotation animation
- Opacity animation

## Creator effects

- Zoom
- Punch-in
- Punch-out
- Speed changes
- Freeze frames
- Basic transitions
- Blur
- Crop
- Vignette
- Simple color adjustments

---

# 13. Captions

aiditor should eventually provide an automatic caption system.

Pipeline:

```text
Video
 ↓
Speech Recognition
 ↓
Transcript
 ↓
Caption Segments
 ↓
Caption Timeline
 ↓
Styled Captions
```

Potential capabilities:

- Automatic transcription
- Word-level timing
- Sentence-level timing
- Caption editing
- Caption splitting
- Caption merging
- Font selection
- Size
- Position
- Color
- Stroke
- Shadow
- Background
- Animation
- Highlighted words
- Emphasis words
- Multiple caption styles

The caption system must remain editable after generation.

AI should generate structured caption data rather than rendering captions permanently into the video.

---

# 14. Stylized Captions

Creator-focused caption styles should eventually support:

- Word highlighting
- Animated words
- Pop-in effects
- Scale emphasis
- Color emphasis
- Shake
- Bounce
- Typewriter
- Karaoke-style timing
- Multiple words per line
- Dynamic line breaking

The system should be data-driven rather than hardcoded to one visual style.

---

# 15. Audio

Eventually support:

- Multiple audio tracks
- Volume
- Gain
- Fade in
- Fade out
- Muting
- Ducking
- Audio normalization
- Basic EQ
- Audio waveform display
- SFX
- Music

AI should eventually be able to perform operations such as:

> Lower the music whenever I speak.

or:

> Add a whoosh when the object enters the frame.

These should become structured timeline operations.

---

# 16. Music and SFX

The editor should eventually support:

- Music tracks
- Sound effects
- SFX timing
- Volume automation
- Audio ducking
- Beat-aware editing where practical

AI agents should be able to reason about timing and placement.

---

# 17. Object Detection and Tracking

One of aiditor's major differentiators should be intelligent object manipulation.

Eventually support:

- Object detection
- Object segmentation
- Object tracking
- Person tracking
- Face tracking
- Manual masks
- Automatic masks
- Tracking points
- Object-specific effects

Example:

> Highlight the Coke can whenever it appears.

The agent should be able to create:

```text
Object
+
Mask
+
Tracking data
+
Effect
```

instead of rendering a permanent video.

---

# 18. Object Highlighting

Creator-style object highlighting should support effects such as:

- Outline
- Glow
- Red highlight
- Circle
- Arrow
- Spotlight
- Background dimming
- Zoom toward object
- Object isolation

Example:

```text
Original video
       ↓
Object tracking
       ↓
Tracked mask
       ↓
Highlight effect
```

The effect should remain editable.

---

# 19. Captions Behind Objects

aiditor should eventually support compositing such as:

```text
Background
     ↓
Caption
     ↓
Foreground subject/object
```

This allows captions to appear behind a person or object.

This requires:

- segmentation
- masks
- compositing layers
- temporal tracking

The system should support these as structured composition elements.

---

# 20. Background Removal

Eventually support:

- AI background removal
- Green screen
- Chroma key
- Manual masking
- Subject segmentation

These should be non-destructive.

---

# 21. Motion Graphics

aiditor should eventually provide a creator-focused motion graphics system.

Support:

- Text
- Shapes
- Arrows
- Circles
- Highlights
- Labels
- Callouts
- Basic animations
- Keyframes
- Transforms
- Opacity
- Blur
- Glow

The system should favor reusable primitives rather than hardcoded one-off effects.

---

# 22. Timeline Model

The timeline is a core part of aiditor.

It should eventually support:

```text
Video Track
Audio Track
Text Track
Graphics Track
Caption Track
Adjustment Track
Mask / Effect data
```

Timeline items should have:

- id
- asset reference
- track reference
- start time
- duration
- source in
- source out
- transform
- effects
- animation
- metadata

The timeline must remain serializable.

---

# 23. Project Serialization

Projects should eventually be saveable as a structured project file.

The project file should contain:

- project settings
- media references
- tracks
- timeline items
- effects
- captions
- masks
- animations
- AI-generated metadata
- editing history where appropriate

Source media should not normally be embedded into the project file.

Instead, projects should reference local media.

---

# 24. Non-Destructive Editing

Source media must remain immutable.

For example:

```text
Original video
      │
      ├── Timeline Clip A
      ├── Timeline Clip B
      └── Timeline Clip C
```

Editing a timeline clip must not modify the original source file.

---

# 25. Proxy Media

aiditor should eventually support proxies for large files.

Example:

```text
Original 4K/8K Media
        ↓
Low-resolution Proxy
        ↓
Fast Preview

Final Export
        ↓
Original Media
```

The user should not have to manually manage this complexity.

---

# 26. AI-Native Editing

AI is not simply an additional feature.

AI is a first-class editor client.

The AI should eventually understand:

- Project
- Assets
- Timeline
- Tracks
- Clips
- Captions
- Effects
- Masks
- Audio
- Playback position

An AI agent should be able to inspect the project before making changes.

---

# 27. AI Editing Examples

Eventually users should be able to say:

> Remove all the dead air.

> Make this faster.

> Turn this into a 30-second Short.

> Add captions.

> Highlight the product whenever I mention it.

> Zoom in when I say "this is crazy."

> Remove the boring section from 2:14 to 3:01.

> Add a whoosh when the text appears.

> Make the captions look like a modern Shorts video.

> Find the best moments from this video and create three Shorts.

The AI should translate these requests into structured editor operations.

---

# 28. AI Must Not Bypass the Editor

Avoid this architecture:

```text
User
 ↓
AI
 ↓
Generate MP4
```

Preferred:

```text
User
 ↓
AI
 ↓
Understand Project
 ↓
Generate Editor Commands
 ↓
ProjectState
 ↓
Preview / Render
```

This preserves:

- editability
- undo
- transparency
- determinism
- user control
- inspectability

---

# 29. MCP

aiditor should eventually expose the editor through MCP.

MCP should allow an external AI agent to:

- inspect project
- inspect assets
- inspect tracks
- inspect timeline
- inspect selected item
- inspect playhead
- create clips
- move clips
- trim clips
- split clips
- delete clips
- add captions
- modify captions
- add effects
- modify effects
- create masks
- manipulate audio
- render/export

The MCP layer should call the same editor commands used by the UI.

```text
MCP
 ↓
Editor Commands
 ↓
ProjectState
```

Never create a separate MCP-specific editing engine.

---

# 30. AI Command Safety

AI-generated operations should eventually be:

- structured
- validated
- deterministic
- inspectable
- undoable

The editor should be able to reject invalid operations.

For example:

```text
AI:
Move clip to -50 seconds

Editor:
Rejected — timeline position cannot be negative.
```

---

# 31. Undo / Redo

All meaningful editor changes should eventually be undoable.

Examples:

- Move clip
- Trim clip
- Split clip
- Delete clip
- Add caption
- Change caption style
- Add effect
- Move effect
- Change volume
- Add mask
- Modify mask
- AI-generated edit

AI operations should not bypass history.

Ideally a complete AI operation can eventually be represented as a logical group:

```text
AI Operation
 ├── remove dead air
 ├── move clips
 ├── add captions
 └── add music
```

and the user can undo the AI operation as one logical action.

---

# 32. Preview Architecture

Preview should prioritize responsiveness.

The preview system may use:

- proxies
- GPU acceleration
- browser/WebView rendering
- WebGL/WebGPU
- native rendering
- cached frames

The exact implementation may evolve.

The important rule is:

> Preview is derived from ProjectState.

---

# 33. Rendering Architecture

The renderer should be replaceable.

Conceptually:

```text
ProjectState
     ↓
Composition Engine
     ↓
Renderer
     ↓
FFmpeg / Native / GPU Infrastructure
     ↓
Final Output
```

Do not hard-code the entire editor around one rendering technology.

---

# 34. FFmpeg

FFmpeg is allowed and encouraged as media infrastructure.

It may be used for:

- encoding
- decoding
- transcoding
- proxy generation
- media metadata
- audio processing
- final export

However:

> FFmpeg is not the editor.

Do not represent the project as a collection of FFmpeg commands.

---

# 35. HyperFrames and Similar Projects

aiditor should NOT depend on HyperFrames, Remotion, or similar frameworks as the core editor architecture.

They may be studied for:

- composition concepts
- rendering ideas
- deterministic media workflows
- agent-friendly architecture

But aiditor should own its:

- ProjectState
- timeline model
- command system
- composition model
- editor architecture
- AI integration

External open-source infrastructure can still be used where appropriate.

---

# 36. Local-First

aiditor should primarily operate locally.

Prefer:

- local files
- local processing
- local AI models where practical
- local rendering
- local project storage

Cloud services should never be required for the basic editor.

---

# 37. Open Source

aiditor should prioritize open-source technologies.

Avoid unnecessary proprietary dependencies.

Important functionality should remain usable without mandatory paid APIs.

Optional cloud/AI integrations may exist later, but the core editor should remain independent.

---

# 38. Privacy

User media should remain local by default.

The application should not upload videos or project data without explicit user action.

AI processing should prefer local models when practical.

---

# 39. Technology Direction

Current stack:

- TypeScript
- React
- Vite
- Tauri
- Rust
- FFmpeg

Potential future technologies may include:

- WebGPU
- WebGL
- faster-whisper
- Whisper
- segmentation models
- object tracking models
- local LLMs
- MCP

Technology choices may change if better open-source solutions become available.

---

# 40. UI Philosophy

The UI should feel like a modern creator tool.

Prioritize:

- dark interface
- clear hierarchy
- minimal clutter
- fast interaction
- keyboard shortcuts
- visible timeline
- obvious selection
- fast preview
- discoverable AI features

The interface should not attempt to reproduce every panel found in professional film editors.

---

# 41. AI Interaction Philosophy

AI should feel like a collaborator rather than a separate chatbot.

Possible future UI:

```text
┌─────────────────────────────────────┐
│              Preview                │
│                                     │
└─────────────────────────────────────┘

Timeline
──────────────────────────────────────

AI:
"Remove the boring parts and make this
feel faster."

[ Apply ] [ Preview Changes ]
```

The user should be able to review AI changes before committing them where appropriate.

---

# 42. AI Planning

For complex requests, AI should eventually produce a plan.

Example:

```text
Request:
"Turn this into a 30 second Short."

Plan:

1. Detect speech
2. Detect silence
3. Detect important segments
4. Remove low-value sections
5. Reframe to 9:16
6. Add captions
7. Add emphasis effects
8. Preview result
```

The plan should be inspectable.

---

# 43. AI + Timeline Understanding

The AI should eventually understand semantic relationships.

For example:

```text
"This product"
```

may refer to an object detected earlier.

```text
"When I say expensive"
```

may refer to a timestamp in the transcript.

```text
"Make this part faster"
```

may refer to the current selected clip.

This requires shared structured metadata between:

- transcript
- timeline
- media
- objects
- captions
- AI context

---

# 44. Automatic Editing

Eventually support intelligent editing such as:

- silence removal
- filler-word removal
- repeated-word detection
- bad-take detection
- scene detection
- highlight detection
- pacing analysis
- automatic reframing
- automatic Shorts creation

These should produce editable timeline changes.

---

# 45. Dead-Air Removal

Example workflow:

```text
Video
 ↓
Speech detection
 ↓
Silence detection
 ↓
Candidate regions
 ↓
User/AI settings
 ↓
Timeline edits
```

The user should eventually be able to configure:

- minimum silence duration
- padding before speech
- padding after speech
- aggressive/conservative mode

---

# 46. Automatic Shorts

Potential workflow:

```text
Long Video
 ↓
Transcript
 ↓
Scene Analysis
 ↓
Important Moment Detection
 ↓
Candidate Clips
 ↓
AI Ranking
 ↓
Short Timeline
 ↓
Captions
 ↓
Effects
 ↓
9:16 Export
```

This is a future capability, not a foundation requirement.

---

# 47. Aspect Ratios

Eventually support:

- 16:9
- 9:16
- 1:1
- 4:5
- custom resolutions

The editor should make reframing between formats easy.

---

# 48. Export

Eventually support common creator outputs.

Examples:

- MP4
- H.264
- H.265
- AAC
- common frame rates
- 1080p
- 4K
- vertical 1080x1920

Export presets should eventually include:

- YouTube
- YouTube Shorts
- Instagram Reels
- TikTok

---

# 49. Performance

aiditor should be designed for large projects.

Important considerations:

- proxy media
- lazy loading
- timeline virtualization
- thumbnail caching
- waveform caching
- background processing
- GPU acceleration
- worker threads
- incremental rendering

Do not optimize prematurely.

Measure before introducing complexity.

---

# 50. Code Architecture

The project should maintain clear separation:

```text
src/
├── core/
│   ├── project/
│   ├── media/
│   ├── timeline/
│   ├── commands/
│   ├── history/
│   ├── composition/
│   └── rendering/
│
├── components/
│   ├── editor/
│   ├── media/
│   ├── preview/
│   ├── timeline/
│   ├── inspector/
│   └── ai/
│
├── services/
│   ├── media/
│   ├── audio/
│   ├── transcription/
│   ├── vision/
│   └── rendering/
│
└── app/
```

The exact structure may evolve.

Do not create abstractions merely for the sake of abstraction.

---

# 51. React Rules

React is the UI layer.

React should:

- render ProjectState
- dispatch commands
- display derived information
- handle UI interaction

React should NOT become the source of truth for editor state.

Avoid:

```text
React state
    ↓
Another timeline state
    ↓
ProjectState
```

Prefer:

```text
ProjectState
    ↓
React
```

with:

```text
User interaction
    ↓
Command
    ↓
ProjectState
    ↓
React re-render
```

---

# 52. Command System

All meaningful editing operations should eventually be commands.

Examples:

```text
AddClip
RemoveClip
MoveClip
TrimClip
SplitClip
SetPlayhead
SelectItem
AddCaption
UpdateCaption
AddEffect
UpdateEffect
AddMask
UpdateMask
SetVolume
AddKeyframe
RemoveKeyframe
```

Commands should be:

- deterministic
- serializable where practical
- testable
- undoable
- UI-independent
- MCP-compatible

---

# 53. Testing

Core editor logic should have unit tests.

Test:

- ProjectState
- commands
- timeline operations
- undo/redo
- serialization
- timing
- validation

UI tests can be added where valuable.

AI behavior should also eventually have deterministic test cases.

---

# 54. Error Handling

Invalid operations should fail safely.

Examples:

- invalid asset reference
- invalid track reference
- negative duration
- invalid source range
- overlapping constraints where prohibited
- missing media
- corrupt project file

Do not silently corrupt ProjectState.

---

# 55. Current Prototype Goal

The immediate objective is NOT to implement the entire product specification.

The immediate objective is:

> Build a basic working video editor that demonstrates the core architecture.

The prototype should include:

- desktop editor UI
- media panel
- preview area
- timeline
- tracks
- timeline clips
- playhead
- inspector
- selection
- move
- trim where practical
- delete
- undo
- redo
- project initialization
- basic sample/demo content

The prototype should be visually understandable and interactive.

---

# 56. Current Prototype Boundaries

Do NOT attempt to fully implement:

- AI agents
- MCP
- automatic editing
- object tracking
- SAM2
- Whisper
- advanced captions
- advanced motion graphics
- full rendering engine
- cloud services
- collaboration
- accounts
- payments

The prototype should establish the foundation for these capabilities.

---

# 57. Development Rule

When implementing a feature:

1. Inspect the existing architecture.
2. Reuse existing models and commands.
3. Do not duplicate ProjectState.
4. Keep source media immutable.
5. Keep editing non-destructive.
6. Keep UI separate from core logic.
7. Add tests for important core behavior.
8. Run the build after meaningful changes.
9. Do not introduce dependencies without a reason.
10. Prefer simple working implementations over premature complexity.

---

# 58. What NOT to Do

Do not:

- rewrite the architecture unnecessarily
- replace ProjectState with a UI state library
- make FFmpeg commands the project model
- create an AI-only editing pipeline
- generate final MP4s instead of editable changes
- hard-code effects into individual components
- introduce cloud dependencies for basic functionality
- add huge frameworks without justification
- implement future features before the current foundation works
- create duplicate representations of the timeline

---

# 59. Definition of a Successful aiditor

The long-term success criterion is:

A user can open aiditor, import real media, edit it manually, ask an AI agent to modify the same project, review those changes, undo them if necessary, and export the final video — all while the underlying project remains structured and editable.

The AI should not be bolted onto a traditional editor.

The editor should be designed from the beginning so that AI is a first-class editor client.

---

# 60. Final Architectural Principle

Everything ultimately comes back to this:

```text
                 HUMAN
                   │
                   ▼
               Editor UI
                   │
                   ▼
             Editor Commands
                   │
                   ▼
             PROJECT STATE
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
     Preview   Composition  History
                   │
                   ▼
                Renderer
                   │
                   ▼
                 FFmpeg


                 AI AGENT
                    │
                    ▼
                   MCP
                    │
                    ▼
             Editor Commands
                    │
                    ▼
              PROJECT STATE
```

**ProjectState is the heart of aiditor.**

Everything else — UI, AI, MCP, preview, rendering, captions, effects, tracking, and automation — should ultimately operate around that core.
