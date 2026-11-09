import React, { useRef, useState, useCallback, useEffect } from 'react'

export interface ThumbwheelProps {
  value: number
  onChange: (val: number) => void
  onCommit?: () => void
  min?: number
  max?: number
  step?: number
  className?: string
  style?: React.CSSProperties
  title?: string
  ariaLabel?: string
  disabled?: boolean
  defaultValue?: number
}

/**
 * Skeuomorphic Horizontal Knurled Thumbwheel / Roller Wheel.
 * - Modeled after studio hardware jog/scrub cylinders with 3D metallic knurling.
 * - Supports dragging horizontally to rotate the cylinder with live tactile rib animation.
 * - Supports mouse wheel rolling over the wheel.
 * - Shift = 10x speed, Alt = 0.1x precision.
 * - Double-click resets to defaultValue (or 0).
 */
export const Thumbwheel: React.FC<ThumbwheelProps> = ({
  value,
  onChange,
  onCommit,
  min = -180,
  max = 180,
  step = 0.5,
  className = '',
  style,
  title,
  ariaLabel,
  disabled = false,
  defaultValue = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startVal: number; moved: boolean } | null>(null)
  const [offsetPx, setOffsetPx] = useState(0)

  // Sync rib position with value changes (each pixel of rotation = visual tooth movement)
  useEffect(() => {
    // 1 unit = 2 pixels of visual knurl translation
    setOffsetPx((value / (step || 1)) * 2)
  }, [value, step])

  const clampValue = useCallback(
    (val: number) => {
      let clamped = val
      if (min !== undefined) clamped = Math.max(min, clamped)
      if (max !== undefined) clamped = Math.min(max, clamped)
      return Math.round(clamped * 1000) / 1000
    },
    [min, max]
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startVal: value,
      moved: false,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || disabled) return
    const dx = e.clientX - dragRef.current.startX
    if (!dragRef.current.moved && Math.abs(dx) > 1) {
      dragRef.current.moved = true
    }

    if (dragRef.current.moved) {
      let multiplier = 1
      if (e.shiftKey) multiplier = 10
      if (e.altKey) multiplier = 0.1

      // Sensitivity: ~1.5px per step
      const stepDelta = (dx / 1.5) * step * multiplier
      const nextVal = clampValue(dragRef.current.startVal + stepDelta)
      onChange(nextVal)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const hadMoved = dragRef.current.moved
    dragRef.current = null
    setIsDragging(false)
    if (hadMoved) {
      onCommit?.()
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    const dir = e.deltaY > 0 ? -1 : 1
    let multiplier = 1
    if (e.shiftKey) multiplier = 10
    if (e.altKey) multiplier = 0.1
    const nextVal = clampValue(value + dir * step * multiplier)
    onChange(nextVal)
    onCommit?.()
  }

  const handleDoubleClick = () => {
    if (disabled) return
    onChange(defaultValue)
    onCommit?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    let delta = 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step
    if (delta !== 0) {
      e.preventDefault()
      let multiplier = 1
      if (e.shiftKey) multiplier = 10
      if (e.altKey) multiplier = 0.1
      const nextVal = clampValue(value + delta * multiplier)
      onChange(nextVal)
      onCommit?.()
    }
  }

  return (
    <div
      ref={containerRef}
      className={`inspector-thumbwheel inspector-slider ${isDragging ? 'dragging active' : ''} ${
        disabled ? 'disabled' : ''
      } ${className}`}
      style={style}
      title={title || 'Knurled thumbwheel: Drag left/right or scroll to adjust. Double-click to reset.'}
      role="slider"
      aria-label={ariaLabel || 'Thumbwheel scrubber'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Flat recessed cavity */}
      <div className="thumbwheel-recess">
        {/* Rotating ribbed cylinder with high-intensity dashes */}
        <div
          className="thumbwheel-cylinder"
          style={{
            backgroundPositionX: `${offsetPx % 5}px`,
          }}
        />

        {/* 3D Optical illusion center lighting gradient (highlight at center, dark shadow at edges) */}
        <div className="thumbwheel-3d-gradient" />

        {/* Top/bottom subtle cylindrical curvature reflection */}
        <div className="thumbwheel-specular" />
      </div>
    </div>
  )
}
