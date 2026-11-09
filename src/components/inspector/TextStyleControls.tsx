import React, { useState, useEffect } from 'react'
import type { TextProperties } from '../../core/timeline/types'
import { ScrubbableNumberInput } from './ScrubbableNumberInput'
import { CustomSelect, type SelectOption } from './CustomSelect'

export const FONT_OPTIONS: SelectOption[] = [
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Montserrat, sans-serif', label: 'Montserrat' },
  { value: 'Roboto, sans-serif', label: 'Roboto' },
  { value: 'Outfit, sans-serif', label: 'Outfit' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: 'Oswald, sans-serif', label: 'Oswald' },
  { value: 'Poppins, sans-serif', label: 'Poppins' },
  { value: 'Trebuchet MS, sans-serif', label: 'Trebuchet MS' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Courier New, monospace', label: 'Courier New' },
]

export const FONT_WEIGHT_OPTIONS: SelectOption[] = [
  { value: '100', label: 'Thin (100)' },
  { value: '300', label: 'Light (300)' },
  { value: '400', label: 'Normal (400)' },
  { value: '500', label: 'Medium (500)' },
  { value: '600', label: 'Semi-Bold (600)' },
  { value: '700', label: 'Bold (700)' },
  { value: '800', label: 'Extra-Bold (800)' },
  { value: '900', label: 'Black (900)' },
]

/**
 * Normalizes any color representation into a clean 6-digit hex string (#RRGGBB).
 * Strips alpha channels because opacity is configured separately via opacity controls.
 */
export function formatHexColor(color?: string, defaultColor = '#FFFFFF'): string {
  if (!color) return defaultColor
  let s = color.trim()
  if (s.startsWith('rgba') || s.startsWith('rgb')) {
    const match = s.match(/\d+(\.\d+)?/g)
    if (match && match.length >= 3) {
      const r = Math.min(255, Math.max(0, parseInt(match[0], 10)))
      const g = Math.min(255, Math.max(0, parseInt(match[1], 10)))
      const b = Math.min(255, Math.max(0, parseInt(match[2], 10)))
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
    }
    return defaultColor
  }
  if (!s.startsWith('#')) {
    s = '#' + s
  }
  let hex = s.slice(1).replace(/[^0-9a-fA-F]/g, '')
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('')
  }
  if (hex.length >= 6) {
    return `#${hex.slice(0, 6).toUpperCase()}`
  }
  return defaultColor
}

/**
 * Standard aiditor color input:
 * Integrates the color swatch inside the default input container alongside the hex text.
 */
export function InspectorColorInput({
  value,
  onChange,
  defaultColor = '#FFFFFF',
  title = 'Color',
}: {
  value: string
  onChange: (hex: string) => void
  defaultColor?: string
  title?: string
}) {
  const hex = formatHexColor(value, defaultColor)
  const [localInput, setLocalInput] = useState(hex)

  useEffect(() => {
    setLocalInput(hex)
  }, [hex])

  const commitHex = (val: string) => {
    const formatted = formatHexColor(val, defaultColor)
    setLocalInput(formatted)
    onChange(formatted)
  }

  return (
    <div className="inspector-color-input-wrapper" title={title}>
      <div className="inspector-color-swatch-box" style={{ backgroundColor: hex }}>
        <input
          type="color"
          className="inspector-color-swatch-native"
          value={hex}
          onChange={(e) => commitHex(e.target.value)}
          title="Pick color"
        />
      </div>
      <input
        type="text"
        className="inspector-color-text-input uppercase"
        value={localInput}
        onChange={(e) => {
          setLocalInput(e.target.value)
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
            onChange(e.target.value.toUpperCase())
          }
        }}
        onBlur={() => commitHex(localInput)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitHex(localInput)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        title="Hex Color Code"
      />
    </div>
  )
}

export interface TextStyleControlsProps {
  properties: Partial<TextProperties>
  onChange: (patch: Partial<TextProperties>) => void
  onClearMergeKey?: () => void
  renderKfControl?: (key: string, titleText: string) => React.ReactNode
  evaluatedFontSize?: number
  evaluatedColor?: string
  evaluatedStrokeWidth?: number
  evaluatedLetterSpacing?: number
  evaluatedLineHeight?: number
  hideOutline?: boolean
}

/**
 * Reusable text typography and font controls shared between Text layers and Caption segments.
 * Every row follows the unified layout: [Label] -> [Control] -> [KF Slot] -> [Reset Button].
 */
export function TextStyleControls({
  properties,
  onChange,
  onClearMergeKey,
  renderKfControl,
  evaluatedFontSize,
  evaluatedColor,
  evaluatedStrokeWidth,
  evaluatedLetterSpacing,
  evaluatedLineHeight,
  hideOutline = false,
}: TextStyleControlsProps) {
  const fontSize = evaluatedFontSize ?? properties.fontSize ?? 64
  const color = evaluatedColor ?? properties.color ?? '#FFFFFF'
  const strokeColor = properties.strokeColor ?? '#000000'
  const strokeWidth = evaluatedStrokeWidth ?? properties.strokeWidth ?? 0
  const letterSpacing = evaluatedLetterSpacing ?? properties.letterSpacing ?? 0
  const lineHeight = evaluatedLineHeight ?? properties.lineHeight ?? 1.2
  const currentWeight = properties.fontWeight ? String(properties.fontWeight) : '600'
  const isBold = currentWeight === '700' || currentWeight === '800' || currentWeight === '900' || currentWeight === 'bold'
  const isItalic = properties.fontStyle === 'italic'
  const isUnderline = properties.underline === true
  const textCase = properties.textCase ?? 'none'
  const align = properties.align ?? 'center'

  return (
    <>
      {/* 1. Font Family */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ fontFamily: 'Inter, sans-serif' })}
          title="Double-click to reset Font Family to Inter"
        >
          Font
        </span>
        <div className="inspector-row-controls">
          <CustomSelect
            value={properties.fontFamily || 'Inter, sans-serif'}
            options={!properties.fontFamily || FONT_OPTIONS.some(option => option.value === properties.fontFamily) ? FONT_OPTIONS : [{ value: properties.fontFamily, label: properties.fontFamily.split(',')[0].replaceAll('"', '') }, ...FONT_OPTIONS]}
            onChange={(val) => onChange({ fontFamily: val })}
            title="Font Family"
          />
          <span className="inspector-kf-spacer" />
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ fontFamily: 'Inter, sans-serif' })}
            title="Reset Font Family to Inter"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 2. Font Weight */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ fontWeight: '600' })}
          title="Double-click to reset Font Weight to Semi-Bold"
        >
          Weight
        </span>
        <div className="inspector-row-controls">
          <CustomSelect
            value={currentWeight}
            options={FONT_WEIGHT_OPTIONS}
            onChange={(val) => onChange({ fontWeight: val })}
            title="Font Weight"
          />
          <span className="inspector-kf-spacer" />
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ fontWeight: '600' })}
            title="Reset Font Weight to Semi-Bold"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 3. Font Style (Bold, Italic, Underline) */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ fontWeight: '400', fontStyle: 'normal', underline: false })}
          title="Double-click to reset Style"
        >
          Style
        </span>
        <div className="inspector-row-controls">
          <div className="inspector-segmented-group" style={{ flex: 1 }}>
            <button
              type="button"
              className={`inspector-segmented-btn ${isBold ? 'active' : ''}`}
              onClick={() => onChange({ fontWeight: isBold ? '400' : '700' })}
              title="Toggle Bold"
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className={`inspector-segmented-btn ${isItalic ? 'active' : ''}`}
              onClick={() => onChange({ fontStyle: isItalic ? 'normal' : 'italic' })}
              title="Toggle Italic"
            >
              <em>I</em>
            </button>
            <button
              type="button"
              className={`inspector-segmented-btn ${isUnderline ? 'active' : ''}`}
              onClick={() => onChange({ underline: !isUnderline })}
              title="Toggle Underline"
            >
              <span style={{ textDecoration: 'underline' }}>U</span>
            </button>
          </div>
          <span className="inspector-kf-spacer" />
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ fontWeight: '400', fontStyle: 'normal', underline: false })}
            title="Reset Font Style"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 4. Text Case */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ textCase: 'none' })}
          title="Double-click to reset Text Case"
        >
          Case
        </span>
        <div className="inspector-row-controls">
          <div className="inspector-segmented-group" style={{ flex: 1 }}>
            <button
              type="button"
              className={`inspector-segmented-btn ${textCase === 'none' ? 'active' : ''}`}
              onClick={() => onChange({ textCase: 'none' })}
              title="Default Text Case"
            >
              Aa
            </button>
            <button
              type="button"
              className={`inspector-segmented-btn ${textCase === 'uppercase' ? 'active' : ''}`}
              onClick={() => onChange({ textCase: 'uppercase' })}
              title="UPPERCASE"
            >
              TT
            </button>
            <button
              type="button"
              className={`inspector-segmented-btn ${textCase === 'lowercase' ? 'active' : ''}`}
              onClick={() => onChange({ textCase: 'lowercase' })}
              title="lowercase"
            >
              tt
            </button>
            <button
              type="button"
              className={`inspector-segmented-btn ${textCase === 'capitalize' ? 'active' : ''}`}
              onClick={() => onChange({ textCase: 'capitalize' })}
              title="Capitalize Words"
            >
              Tt
            </button>
          </div>
          <span className="inspector-kf-spacer" />
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ textCase: 'none' })}
            title="Reset Text Case"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 5. Alignment */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ align: 'center' })}
          title="Double-click to reset Alignment to Center"
        >
          Align
        </span>
        <div className="inspector-row-controls">
          <div className="inspector-segmented-group" style={{ flex: 1 }}>
            <button
              type="button"
              className={`inspector-segmented-btn ${align === 'left' ? 'active' : ''}`}
              onClick={() => onChange({ align: 'left' })}
              title="Align Left"
            >
              ⇤
            </button>
            <button
              type="button"
              className={`inspector-segmented-btn ${align === 'center' ? 'active' : ''}`}
              onClick={() => onChange({ align: 'center' })}
              title="Align Center"
            >
              ≡
            </button>
            <button
              type="button"
              className={`inspector-segmented-btn ${align === 'right' ? 'active' : ''}`}
              onClick={() => onChange({ align: 'right' })}
              title="Align Right"
            >
              ⇥
            </button>
          </div>
          <span className="inspector-kf-spacer" />
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ align: 'center' })}
            title="Reset Alignment to Center"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 6. Font Size with Keyframing and Reset */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ fontSize: 64 })}
          title="Double-click to reset Font Size to 64px"
        >
          Size
        </span>
        <div className="inspector-row-controls">
          <input
            type="range"
            className="inspector-slider"
            min={12}
            max={200}
            step={1}
            value={fontSize}
            onChange={(e) => onChange({ fontSize: parseFloat(e.target.value) })}
            onPointerUp={onClearMergeKey}
            title="Font Size (12px to 200px)"
          />
          <ScrubbableNumberInput
            value={fontSize}
            step={1}
            decimals={0}
            min={8}
            max={400}
            title="Font Size"
            onChange={(v) => onChange({ fontSize: v })}
            onCommit={onClearMergeKey}
          />
          {renderKfControl ? renderKfControl('fontSize', 'Keyframe Font Size') : <span className="inspector-kf-spacer" />}
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ fontSize: 64 })}
            title="Reset Font Size to 64px"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 7. Letter Spacing (Tracking) */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ letterSpacing: 0 })}
          title="Double-click to reset Letter Spacing to 0"
        >
          Tracking
        </span>
        <div className="inspector-row-controls">
          <input
            type="range"
            className="inspector-slider"
            min={-5}
            max={30}
            step={0.5}
            value={letterSpacing}
            onChange={(e) => onChange({ letterSpacing: parseFloat(e.target.value) })}
            onPointerUp={onClearMergeKey}
            title="Letter Spacing (-5px to 30px)"
          />
          <ScrubbableNumberInput
            value={letterSpacing}
            step={0.5}
            decimals={1}
            min={-20}
            max={100}
            title="Letter Spacing (px)"
            onChange={(v) => onChange({ letterSpacing: v })}
            onCommit={onClearMergeKey}
          />
          {renderKfControl ? renderKfControl('letterSpacing', 'Keyframe Letter Spacing') : <span className="inspector-kf-spacer" />}
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ letterSpacing: 0 })}
            title="Reset Letter Spacing to 0"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 8. Line Spacing (Line Height) */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ lineHeight: 1.2 })}
          title="Double-click to reset Line Spacing to 1.2"
        >
          Line Spacing
        </span>
        <div className="inspector-row-controls">
          <input
            type="range"
            className="inspector-slider"
            min={0.8}
            max={2.5}
            step={0.05}
            value={lineHeight}
            onChange={(e) => onChange({ lineHeight: parseFloat(e.target.value) })}
            onPointerUp={onClearMergeKey}
            title="Line Spacing (0.8 to 2.5)"
          />
          <ScrubbableNumberInput
            value={lineHeight}
            step={0.05}
            decimals={2}
            min={0.5}
            max={5}
            title="Line Height"
            onChange={(v) => onChange({ lineHeight: v })}
            onCommit={onClearMergeKey}
          />
          {renderKfControl ? renderKfControl('lineHeight', 'Keyframe Line Spacing') : <span className="inspector-kf-spacer" />}
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ lineHeight: 1.2 })}
            title="Reset Line Spacing to 1.2"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 9. Font Color with Internal Swatch */}
      <div className="inspector-row">
        <span
          className="inspector-label resettable"
          onDoubleClick={() => onChange({ color: '#FFFFFF' })}
          title="Double-click to reset Color to #FFFFFF"
        >
          Color
        </span>
        <div className="inspector-row-controls">
          <InspectorColorInput
            value={color}
            onChange={(val) => onChange({ color: val })}
            defaultColor="#FFFFFF"
            title="Font Color"
          />
          {renderKfControl ? renderKfControl('color', 'Keyframe Color') : <span className="inspector-kf-spacer" />}
          <button
            type="button"
            className="inspector-reset-icon-btn"
            onClick={() => onChange({ color: '#FFFFFF' })}
            title="Reset Color to #FFFFFF"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 10. Outline Color with Internal Swatch */}
      {!hideOutline && (
        <div className="inspector-row">
          <span
            className="inspector-label resettable"
            onDoubleClick={() => onChange({ strokeColor: '#000000' })}
            title="Double-click to reset Outline Color to #000000"
          >
            Outline Color
          </span>
          <div className="inspector-row-controls">
            <InspectorColorInput
              value={strokeColor}
              onChange={(val) => onChange({ strokeColor: val })}
              defaultColor="#000000"
              title="Outline Color"
            />
            <span className="inspector-kf-spacer" />
            <button
              type="button"
              className="inspector-reset-icon-btn"
              onClick={() => onChange({ strokeColor: '#000000' })}
              title="Reset Outline Color to #000000"
            >
              ↺
            </button>
          </div>
        </div>
      )}

      {/* 11. Outline Width */}
      {!hideOutline && (
        <div className="inspector-row">
          <span
            className="inspector-label resettable"
            onDoubleClick={() => onChange({ strokeWidth: 0 })}
            title="Double-click to reset Outline Width to 0"
          >
            Outline Width
          </span>
          <div className="inspector-row-controls">
            <input
              type="range"
              className="inspector-slider"
              min={0}
              max={30}
              step={1}
              value={strokeWidth}
              onChange={(e) => onChange({ strokeWidth: parseFloat(e.target.value) })}
              onPointerUp={onClearMergeKey}
              title="Outline Width (0 to 30px)"
            />
            <ScrubbableNumberInput
              value={strokeWidth}
              step={1}
              decimals={0}
              min={0}
              max={50}
              title="Outline Width (px)"
              onChange={(v) => onChange({ strokeWidth: v })}
              onCommit={onClearMergeKey}
            />
            {renderKfControl ? renderKfControl('strokeWidth', 'Keyframe Outline Width') : <span className="inspector-kf-spacer" />}
            <button
              type="button"
              className="inspector-reset-icon-btn"
              onClick={() => onChange({ strokeWidth: 0 })}
              title="Reset Outline Width to 0"
            >
              ↺
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export interface TextShadowSectionProps {
  properties: Partial<TextProperties>
  collapsed: boolean
  onToggleCollapse: () => void
  onChange: (patch: Partial<TextProperties>) => void
  onClearMergeKey?: () => void
  renderKfControl?: (key: string, titleText: string) => React.ReactNode
  onReset?: () => void
  evaluatedBlur?: number
  evaluatedOffsetX?: number
  evaluatedOffsetY?: number
  evaluatedOpacity?: number
}

/**
 * Drop Shadow Section with header toggle switch.
 * Offsets X & Y reside on the SAME line.
 */
export function TextShadowSection({
  properties,
  collapsed,
  onToggleCollapse,
  onChange,
  onClearMergeKey,
  renderKfControl,
  onReset,
  evaluatedBlur,
  evaluatedOffsetX,
  evaluatedOffsetY,
  evaluatedOpacity,
}: TextShadowSectionProps) {
  const isEnabled = properties.shadowEnabled !== false && properties.shadowEnabled === true
  const shadowColor = properties.shadowColor ?? '#000000'
  const opacity = evaluatedOpacity ?? properties.shadowOpacity ?? 0.8
  const offsetX = evaluatedOffsetX ?? properties.shadowOffsetX ?? 2
  const offsetY = evaluatedOffsetY ?? properties.shadowOffsetY ?? 4
  const blur = evaluatedBlur ?? properties.shadowBlur ?? 10

  return (
    <div className="inspector-section">
      <div className="inspector-section-header" onClick={onToggleCollapse}>
        <div className="inspector-header-left">
          <span className="inspector-chevron">{collapsed ? '▶' : '▼'}</span>
          <input
            type="checkbox"
            className="inspector-header-toggle"
            checked={isEnabled}
            onChange={(e) => {
              e.stopPropagation()
              onChange({ shadowEnabled: e.target.checked })
            }}
            onClick={(e) => e.stopPropagation()}
            title={isEnabled ? 'Disable Drop Shadow' : 'Enable Drop Shadow'}
          />
          <span className="inspector-section-title">Drop Shadow</span>
        </div>
        <div className="inspector-header-actions">
          {onReset && (
            <button
              type="button"
              className="inspector-reset-icon-btn"
              onClick={(e) => {
                e.stopPropagation()
                onReset()
              }}
              title="Reset Drop Shadow"
            >
              ↺
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className={`inspector-section-content ${!isEnabled ? 'is-disabled-effect' : ''}`}>
          {/* Shadow Color with Internal Swatch */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ shadowColor: '#000000' })}
              title="Double-click to reset Shadow Color to #000000"
            >
              Color
            </span>
            <div className="inspector-row-controls">
              <InspectorColorInput
                value={shadowColor}
                onChange={(val) => onChange({ shadowColor: val })}
                defaultColor="#000000"
                title="Shadow Color"
              />
              <span className="inspector-kf-spacer" />
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ shadowColor: '#000000' })}
                title="Reset Shadow Color to #000000"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Shadow Opacity */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ shadowOpacity: 0.8 })}
              title="Double-click to reset Shadow Opacity to 80%"
            >
              Opacity
            </span>
            <div className="inspector-row-controls">
              <input
                type="range"
                className="inspector-slider"
                min={0}
                max={100}
                step={1}
                value={Math.round(opacity * 100)}
                onChange={(e) => onChange({ shadowOpacity: parseFloat(e.target.value) / 100 })}
                onPointerUp={onClearMergeKey}
                title="Shadow Opacity (0% to 100%)"
              />
              <ScrubbableNumberInput
                value={Math.round(opacity * 100)}
                step={1}
                decimals={0}
                min={0}
                max={100}
                title="Shadow Opacity %"
                onChange={(v) => onChange({ shadowOpacity: v / 100 })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('shadowOpacity', 'Keyframe Shadow Opacity') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ shadowOpacity: 0.8 })}
                title="Reset Shadow Opacity to 80%"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Offset X & Y in SAME line */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ shadowOffsetX: 2, shadowOffsetY: 4 })}
              title="Double-click to reset Offset to (2, 4)"
            >
              Offset
            </span>
            <div className="inspector-row-controls">
              <span
                className="inspector-sublabel resettable"
                onDoubleClick={() => onChange({ shadowOffsetX: 2 })}
                title="Double-click to reset Offset X to 2"
              >
                X
              </span>
              <ScrubbableNumberInput
                value={offsetX}
                step={1}
                decimals={1}
                min={-200}
                max={200}
                title="Shadow Offset X"
                onChange={(v) => onChange({ shadowOffsetX: v })}
                onCommit={onClearMergeKey}
              />
              <div className="inspector-link-placeholder" />
              <span
                className="inspector-sublabel resettable"
                onDoubleClick={() => onChange({ shadowOffsetY: 4 })}
                title="Double-click to reset Offset Y to 4"
              >
                Y
              </span>
              <ScrubbableNumberInput
                value={offsetY}
                step={1}
                decimals={1}
                min={-200}
                max={200}
                title="Shadow Offset Y"
                onChange={(v) => onChange({ shadowOffsetY: v })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('shadowOffsetX', 'Keyframe Shadow Offset') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ shadowOffsetX: 2, shadowOffsetY: 4 })}
                title="Reset Offset to (2, 4)"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Blur */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ shadowBlur: 10 })}
              title="Double-click to reset Shadow Blur to 10"
            >
              Blur
            </span>
            <div className="inspector-row-controls">
              <input
                type="range"
                className="inspector-slider"
                min={0}
                max={60}
                step={1}
                value={blur}
                onChange={(e) => onChange({ shadowBlur: parseFloat(e.target.value) })}
                onPointerUp={onClearMergeKey}
                title="Shadow Blur (0 to 60px)"
              />
              <ScrubbableNumberInput
                value={blur}
                step={1}
                decimals={0}
                min={0}
                max={100}
                title="Shadow Blur"
                onChange={(v) => onChange({ shadowBlur: v })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('shadowBlur', 'Keyframe Shadow Blur') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ shadowBlur: 10 })}
                title="Reset Blur to 10"
              >
                ↺
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export interface TextBackgroundSectionProps {
  properties: Partial<TextProperties>
  collapsed: boolean
  onToggleCollapse: () => void
  onChange: (patch: Partial<TextProperties>) => void
  onClearMergeKey?: () => void
  renderKfControl?: (key: string, titleText: string) => React.ReactNode
  onReset?: () => void
  evaluatedCornerRadius?: number
  evaluatedPaddingX?: number
  evaluatedPaddingY?: number
  evaluatedBgStrokeWidth?: number
  evaluatedBgOffsetX?: number
  evaluatedBgOffsetY?: number
  evaluatedBgOpacity?: number
}

/**
 * Background Section with header toggle switch.
 * Padding X & Y and Position X & Y reside on the SAME line.
 */
export function TextBackgroundSection({
  properties,
  collapsed,
  onToggleCollapse,
  onChange,
  onClearMergeKey,
  renderKfControl,
  onReset,
  evaluatedCornerRadius,
  evaluatedPaddingX,
  evaluatedPaddingY,
  evaluatedBgStrokeWidth,
  evaluatedBgOffsetX,
  evaluatedBgOffsetY,
  evaluatedBgOpacity,
}: TextBackgroundSectionProps) {
  const isEnabled = properties.backgroundEnabled !== false && properties.backgroundEnabled === true
  const bgColor = properties.backgroundColor ?? '#000000'
  const bgOpacity = evaluatedBgOpacity ?? properties.backgroundOpacity ?? 0.7
  const cornerRadius = evaluatedCornerRadius ?? properties.cornerRadius ?? 6
  const paddingX = evaluatedPaddingX ?? properties.paddingX ?? properties.padding ?? 16
  const paddingY = evaluatedPaddingY ?? properties.paddingY ?? properties.padding ?? 10
  const bgStrokeColor = properties.bgStrokeColor ?? '#ffffff'
  const bgStrokeWidth = evaluatedBgStrokeWidth ?? properties.bgStrokeWidth ?? 0
  const bgOffsetX = evaluatedBgOffsetX ?? properties.bgOffsetX ?? 0
  const bgOffsetY = evaluatedBgOffsetY ?? properties.bgOffsetY ?? 0

  return (
    <div className="inspector-section">
      <div className="inspector-section-header" onClick={onToggleCollapse}>
        <div className="inspector-header-left">
          <span className="inspector-chevron">{collapsed ? '▶' : '▼'}</span>
          <input
            type="checkbox"
            className="inspector-header-toggle"
            checked={isEnabled}
            onChange={(e) => {
              e.stopPropagation()
              onChange({ backgroundEnabled: e.target.checked })
            }}
            onClick={(e) => e.stopPropagation()}
            title={isEnabled ? 'Disable Background' : 'Enable Background'}
          />
          <span className="inspector-section-title">Background</span>
        </div>
        <div className="inspector-header-actions">
          {onReset && (
            <button
              type="button"
              className="inspector-reset-icon-btn"
              onClick={(e) => {
                e.stopPropagation()
                onReset()
              }}
              title="Reset Background"
            >
              ↺
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className={`inspector-section-content ${!isEnabled ? 'is-disabled-effect' : ''}`}>
          {/* Fill Color with Internal Swatch */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ backgroundColor: '#000000' })}
              title="Double-click to reset Fill Color to #000000"
            >
              Fill Color
            </span>
            <div className="inspector-row-controls">
              <InspectorColorInput
                value={bgColor}
                onChange={(val) => onChange({ backgroundColor: val })}
                defaultColor="#000000"
                title="Background Fill Color"
              />
              <span className="inspector-kf-spacer" />
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ backgroundColor: '#000000' })}
                title="Reset Fill Color to #000000"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Opacity */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ backgroundOpacity: 0.7 })}
              title="Double-click to reset Background Opacity to 70%"
            >
              Opacity
            </span>
            <div className="inspector-row-controls">
              <input
                type="range"
                className="inspector-slider"
                min={0}
                max={100}
                step={1}
                value={Math.round(bgOpacity * 100)}
                onChange={(e) => onChange({ backgroundOpacity: parseFloat(e.target.value) / 100 })}
                onPointerUp={onClearMergeKey}
                title="Background Opacity (0% to 100%)"
              />
              <ScrubbableNumberInput
                value={Math.round(bgOpacity * 100)}
                step={1}
                decimals={0}
                min={0}
                max={100}
                title="Background Opacity %"
                onChange={(v) => onChange({ backgroundOpacity: v / 100 })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('backgroundOpacity', 'Keyframe Background Opacity') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ backgroundOpacity: 0.7 })}
                title="Reset Opacity to 70%"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Corner Radius */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ cornerRadius: 6 })}
              title="Double-click to reset Corner Radius to 6px"
            >
              Corner Radius
            </span>
            <div className="inspector-row-controls">
              <input
                type="range"
                className="inspector-slider"
                min={0}
                max={50}
                step={1}
                value={cornerRadius}
                onChange={(e) => onChange({ cornerRadius: parseFloat(e.target.value) })}
                onPointerUp={onClearMergeKey}
                title="Corner Radius (0 to 50px)"
              />
              <ScrubbableNumberInput
                value={cornerRadius}
                step={1}
                decimals={0}
                min={0}
                max={100}
                title="Corner Radius (px)"
                onChange={(v) => onChange({ cornerRadius: v })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('cornerRadius', 'Keyframe Corner Radius') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ cornerRadius: 6 })}
                title="Reset Corner Radius to 6px"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Padding X & Y in SAME line */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ paddingX: 16, paddingY: 10 })}
              title="Double-click to reset Padding to (16, 10)"
            >
              Padding
            </span>
            <div className="inspector-row-controls">
              <span
                className="inspector-sublabel resettable"
                onDoubleClick={() => onChange({ paddingX: 16 })}
                title="Double-click to reset Padding X to 16px"
              >
                X
              </span>
              <ScrubbableNumberInput
                value={paddingX}
                step={1}
                decimals={0}
                min={0}
                max={200}
                title="Padding X (px)"
                onChange={(v) => onChange({ paddingX: v })}
                onCommit={onClearMergeKey}
              />
              <div className="inspector-link-placeholder" />
              <span
                className="inspector-sublabel resettable"
                onDoubleClick={() => onChange({ paddingY: 10 })}
                title="Double-click to reset Padding Y to 10px"
              >
                Y
              </span>
              <ScrubbableNumberInput
                value={paddingY}
                step={1}
                decimals={0}
                min={0}
                max={200}
                title="Padding Y (px)"
                onChange={(v) => onChange({ paddingY: v })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('paddingX', 'Keyframe Padding') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ paddingX: 16, paddingY: 10 })}
                title="Reset Padding to (16, 10)"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Outline Color with Internal Swatch */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ bgStrokeColor: '#ffffff' })}
              title="Double-click to reset Outline Color to #FFFFFF"
            >
              Outline Color
            </span>
            <div className="inspector-row-controls">
              <InspectorColorInput
                value={bgStrokeColor}
                onChange={(val) => onChange({ bgStrokeColor: val })}
                defaultColor="#FFFFFF"
                title="Background Outline Color"
              />
              <span className="inspector-kf-spacer" />
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ bgStrokeColor: '#ffffff' })}
                title="Reset Outline Color to #FFFFFF"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Outline Width */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ bgStrokeWidth: 0 })}
              title="Double-click to reset Outline Width to 0"
            >
              Outline Width
            </span>
            <div className="inspector-row-controls">
              <input
                type="range"
                className="inspector-slider"
                min={0}
                max={20}
                step={1}
                value={bgStrokeWidth}
                onChange={(e) => onChange({ bgStrokeWidth: parseFloat(e.target.value) })}
                onPointerUp={onClearMergeKey}
                title="Background Outline Width (0 to 20px)"
              />
              <ScrubbableNumberInput
                value={bgStrokeWidth}
                step={1}
                decimals={0}
                min={0}
                max={50}
                title="Outline Width (px)"
                onChange={(v) => onChange({ bgStrokeWidth: v })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('bgStrokeWidth', 'Keyframe Background Outline Width') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ bgStrokeWidth: 0 })}
                title="Reset Outline Width to 0"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Position X & Y in SAME line */}
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => onChange({ bgOffsetX: 0, bgOffsetY: 0 })}
              title="Double-click to reset Position to (0, 0)"
            >
              Position
            </span>
            <div className="inspector-row-controls">
              <span
                className="inspector-sublabel resettable"
                onDoubleClick={() => onChange({ bgOffsetX: 0 })}
                title="Double-click to reset Position X to 0"
              >
                X
              </span>
              <ScrubbableNumberInput
                value={bgOffsetX}
                step={1}
                decimals={0}
                min={-500}
                max={500}
                title="Background Position X"
                onChange={(v) => onChange({ bgOffsetX: v })}
                onCommit={onClearMergeKey}
              />
              <div className="inspector-link-placeholder" />
              <span
                className="inspector-sublabel resettable"
                onDoubleClick={() => onChange({ bgOffsetY: 0 })}
                title="Double-click to reset Position Y to 0"
              >
                Y
              </span>
              <ScrubbableNumberInput
                value={bgOffsetY}
                step={1}
                decimals={0}
                min={-500}
                max={500}
                title="Background Position Y"
                onChange={(v) => onChange({ bgOffsetY: v })}
                onCommit={onClearMergeKey}
              />
              {renderKfControl ? renderKfControl('bgOffsetX', 'Keyframe Background Position') : <span className="inspector-kf-spacer" />}
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => onChange({ bgOffsetX: 0, bgOffsetY: 0 })}
                title="Reset Position to (0, 0)"
              >
                ↺
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
