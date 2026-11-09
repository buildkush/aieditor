import React, { useState, useRef, useEffect } from 'react'

export interface ScrubbableNumberInputProps {
  label?: string
  value: number
  onChange: (val: number) => void
  onCommit?: () => void
  step?: number
  decimals?: number
  min?: number
  max?: number
  suffix?: string
  disabled?: boolean
  className?: string
  title?: string
  ariaLabel?: string
  style?: React.CSSProperties
}

/**
 * Scrubbable number input field designed for video editing inspectors.
 * - Displays value formatted to specified decimal places (e.g. 3 decimals for X/Y).
 * - On hover, cursor turns into a horizontal bidirectional resize arrow (ew-resize).
 * - Clicking and dragging left/right increases or decreases value in real time.
 * - Clicking directly activates inline text editing with keyboard input.
 * - Shift = 10x speed, Alt = 0.1x precision.
 * - Native browser up/down spinners are suppressed.
 */
export const ScrubbableNumberInput: React.FC<ScrubbableNumberInputProps> = ({
  label,
  value,
  onChange,
  onCommit,
  step = 1,
  decimals = 3,
  min,
  max,
  suffix,
  disabled = false,
  className = '',
  title,
  ariaLabel,
  style,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const dragStartRef = useRef<{ startX: number; startVal: number; moved: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync text input whenever value changes and not actively typing
  useEffect(() => {
    if (!isEditing) {
      setTextInput(value.toFixed(decimals))
    }
  }, [value, decimals, isEditing])

  // Focus and select all text when switching to edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const clampAndRound = (val: number): number => {
    let clamped = val
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    const factor = Math.pow(10, decimals)
    return Math.round(clamped * factor) / factor
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || isEditing || e.button !== 0) return

    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartRef.current = {
      startX: e.clientX,
      startVal: value,
      moved: false,
    }
    setIsDragging(false)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || disabled) return

    const dx = e.clientX - dragStartRef.current.startX
    if (!dragStartRef.current.moved && Math.abs(dx) > 2) {
      dragStartRef.current.moved = true
      setIsDragging(true)
    }

    if (dragStartRef.current.moved) {
      // Speed multiplier
      let mult = 1
      if (e.shiftKey) mult = 10
      if (e.altKey) mult = 0.1

      const deltaValue = dx * (step * 0.1) * mult
      const nextVal = clampAndRound(dragStartRef.current.startVal + deltaValue)
      onChange(nextVal)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return

    const wasMoved = dragStartRef.current.moved
    dragStartRef.current = null
    setIsDragging(false)

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    if (wasMoved) {
      onCommit?.()
    } else {
      // User simply clicked: open inline text editing
      setIsEditing(true)
      setTextInput(value.toFixed(decimals))
    }
  }

  const commitText = () => {
    setIsEditing(false)
    const parsed = parseFloat(textInput)
    if (!isNaN(parsed)) {
      const nextVal = clampAndRound(parsed)
      onChange(nextVal)
    } else {
      setTextInput(value.toFixed(decimals))
    }
    onCommit?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitText()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setTextInput(value.toFixed(decimals))
      onCommit?.()
    }
  }

  return (
    <div
      className={`scrubbable-input-wrapper ${isDragging ? 'dragging' : ''} ${
        isEditing ? 'editing' : ''
      } ${disabled ? 'disabled' : ''} ${className}`}
      style={style}
      title={
        title ||
        `${label ? label + ': ' : ''}Drag left/right to adjust. Click to type.`
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label={ariaLabel || label || 'Numeric input'}
    >
      {label && <span className="scrubbable-label">{label}</span>}

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="scrubbable-inline-input"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onBlur={commitText}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className="scrubbable-value-display">
          {value.toFixed(decimals)}
        </span>
      )}

      {suffix && <span className="scrubbable-suffix">{suffix}</span>}
      <span className="scrubbable-drag-arrow" aria-hidden="true">
        ↔
      </span>
    </div>
  )
}
