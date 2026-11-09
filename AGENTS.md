# aiditor — Agent Instructions

## 1. Project

aiditor is a local-first, desktop video editor designed from the ground up to be operated by both humans and AI agents.

The long-term goal is to build a serious content-creation editor for:

- YouTube
- YouTube Shorts
- Instagram Reels
- TikTok
- Other short-form and long-form content

The editor should eventually support:

- Normal timeline editing
- Automatic editing
- Dead-air removal
- Captions
- Stylized captions
- Motion graphics
- Keyframe animation
- Zooms
- SFX
- Music
- Object tracking
- Object highlighting
- Masks
- Captions behind subjects/objects
- Background removal
- Chroma key
- AI-assisted editing
- MCP-based AI agents

Do not attempt to implement the entire vision at once.

---

# 2. Fundamental Architecture Rule

## ProjectState is the single source of truth.

Everything about an editable project must ultimately be represented by `ProjectState`.

The rendered video is NOT the source of truth.

FFmpeg commands are NOT the source of truth.

React/UI state is NOT the source of truth.

Preview output is NOT the source of truth.

Rendering is always derived from `ProjectState`.

---

# 3. Permanent Engineering Rules

1. **Every editing operation requires a ProjectState.** No timeline, clip, or track manipulation can occur outside an active `ProjectState`.
2. **AI must not maintain a parallel editing state.** AI and human editors are clients of the exact same project system. AI never creates a separate internal timeline or generates a finished MP4 to bypass the editor.
3. **Human and AI must use the same Editor Command layer.** UI interactions and AI/MCP tool calls must both dispatch typed `EditorCommand` instances to mutate `ProjectState`.
4. **UI and AI must not directly mutate ProjectState.** Direct in-place mutation is strictly forbidden. All mutations are deterministic and produced via commands.
5. **Temporary and unsaved projects are real ProjectState instances.** A project does not need an on-disk destination to be fully functional; it operates on a genuine `ProjectState` backed by application data cache.
6. **Source media is immutable.** Source files are never modified, re-encoded in place, or destructively edited.
7. **Four-way architectural separation:**
   - `ProjectState` (in-memory state of truth)
   - Project File (`.aiditor` serialized representation)
   - Source Media (read-only referenced local assets)
   - Generated Cache (proxies, thumbnails, waveforms, analysis stored in app data)

Core architecture:

```text
Human
  ↓
Editor UI
  ↓
Editor Commands
  ↓
ProjectState
  ├──→ Preview
  └──→ Renderer
          ↓
        FFmpeg

AI Agent
  ↓
MCP / Agent Interface
  ↓
Editor Commands
  ↓
ProjectState
```