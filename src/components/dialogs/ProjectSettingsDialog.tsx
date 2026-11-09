import React, { useState, useEffect } from 'react'
import type { ProjectState } from '../../core/project/projectState'
import type { UpdateProjectSettingsOptions } from '../../core/commands/projectCommands'
import './ProjectSettingsDialog.css'

interface ProjectSettingsDialogProps {
  isOpen: boolean
  state: ProjectState
  onSave: (options: UpdateProjectSettingsOptions) => void
  onClose: () => void
}

interface ResolutionPreset {
  label: string
  sublabel: string
  width: number
  height: number
}

const PRESETS: ResolutionPreset[] = [
  { label: '1080p Landscape', sublabel: '1920 × 1080 • 16:9', width: 1920, height: 1080 },
  { label: 'Vertical Video', sublabel: '1080 × 1920 • 9:16 (Shorts/Reels/TikTok)', width: 1080, height: 1920 },
  { label: '4K UHD', sublabel: '3840 × 2160 • 16:9', width: 3840, height: 2160 },
  { label: 'Square', sublabel: '1080 × 1080 • 1:1', width: 1080, height: 1080 },
]

export const ProjectSettingsDialog: React.FC<ProjectSettingsDialogProps> = ({
  isOpen,
  state,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(state.name)
  const [width, setWidth] = useState(state.settings.width || 1920)
  const [height, setHeight] = useState(state.settings.height || 1080)
  const [fps, setFps] = useState(state.settings.fps || 30)
  const [sampleRate, setSampleRate] = useState(state.settings.sampleRate || 48000)

  useEffect(() => {
    if (isOpen) {
      setName(state.name)
      setWidth(state.settings.width || 1920)
      setHeight(state.settings.height || 1080)
      setFps(state.settings.fps || 30)
      setSampleRate(state.settings.sampleRate || 48000)
    }
  }, [isOpen, state])

  if (!isOpen) return null

  const handleApplyPreset = (preset: ResolutionPreset) => {
    setWidth(preset.width)
    setHeight(preset.height)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      name: name.trim() || 'Untitled Project',
      width: Math.max(320, width),
      height: Math.max(240, height),
      fps,
      sampleRate,
    })
    onClose()
  }

  return (
    <div className="aiditor-modal-backdrop" onClick={onClose}>
      <div
        className="aiditor-modal-card project-settings-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
      >
        <div className="aiditor-modal-header">
          <div className="aiditor-modal-title" id="project-settings-title">
            <span className="modal-title-icon">⚙️</span>
            <span>Project Settings</span>
          </div>
          <button className="aiditor-modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="project-settings-form">
          <div className="form-group">
            <label className="form-label" htmlFor="proj-name">Project Name</label>
            <input
              id="proj-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project Name"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Resolution Presets</label>
            <div className="preset-grid">
              {PRESETS.map((p) => {
                const isActive = width === p.width && height === p.height
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`preset-btn ${isActive ? 'active' : ''}`}
                    onClick={() => handleApplyPreset(p)}
                  >
                    <span className="preset-btn-name">{p.label}</span>
                    <span className="preset-btn-desc">{p.sublabel}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group form-col">
              <label className="form-label" htmlFor="proj-width">Canvas Width (px)</label>
              <input
                id="proj-width"
                type="number"
                className="form-input"
                min={320}
                max={7680}
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value, 10) || 1920)}
              />
            </div>
            <div className="form-group form-col">
              <label className="form-label" htmlFor="proj-height">Canvas Height (px)</label>
              <input
                id="proj-height"
                type="number"
                className="form-input"
                min={240}
                max={4320}
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value, 10) || 1080)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group form-col">
              <label className="form-label" htmlFor="proj-fps">Frame Rate (FPS)</label>
              <select
                id="proj-fps"
                className="form-select"
                value={fps}
                onChange={(e) => setFps(parseFloat(e.target.value) || 30)}
              >
                <option value={24}>24 fps (Cinema)</option>
                <option value={25}>25 fps (PAL)</option>
                <option value={30}>30 fps (Web / NTSC)</option>
                <option value={60}>60 fps (Smooth / Gaming)</option>
              </select>
            </div>
            <div className="form-group form-col">
              <label className="form-label" htmlFor="proj-samplerate">Audio Sample Rate</label>
              <select
                id="proj-samplerate"
                className="form-select"
                value={sampleRate}
                onChange={(e) => setSampleRate(parseInt(e.target.value, 10) || 48000)}
              >
                <option value={44100}>44.1 kHz (CD Quality)</option>
                <option value={48000}>48.0 kHz (Broadcast Video Standard)</option>
              </select>
            </div>
          </div>

          <div className="aiditor-modal-footer">
            <button type="button" className="modal-btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="modal-btn primary">
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
