import { useState, useRef, useEffect, useCallback } from 'react'
import type { EditorCommand } from '../../core/commands/editorCommand'
import { SetPlayheadCommand } from '../../core/commands/editorCommand'

export type PlaybackMode = 'forward' | 'backward' | 'stopped'

export interface UsePlayerOptions {
  playheadTime: number
  contentDuration: number
  timelineDuration: number
  fps: number
  dispatch: (command: EditorCommand) => void
  previewContainerRef?: React.RefObject<HTMLDivElement | null>
}

export function usePlayer({
  playheadTime,
  contentDuration,
  timelineDuration,
  fps,
  dispatch,
  previewContainerRef,
}: UsePlayerOptions) {
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('stopped')
  const [isLooping, setIsLooping] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const animFrameRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const playheadRef = useRef(playheadTime)
  playheadRef.current = playheadTime

  const stop = useCallback(() => {
    setPlaybackMode('stopped')
  }, [])

  const play = useCallback(() => {
    const effectiveEnd = contentDuration > 0 ? contentDuration : timelineDuration
    if (playheadRef.current >= effectiveEnd) {
      dispatch(new SetPlayheadCommand(0))
    }
    setPlaybackMode('forward')
  }, [contentDuration, timelineDuration, dispatch])

  const playBackwards = useCallback(() => {
    const effectiveEnd = contentDuration > 0 ? contentDuration : timelineDuration
    if (playheadRef.current <= 0) {
      dispatch(new SetPlayheadCommand(effectiveEnd))
    }
    setPlaybackMode('backward')
  }, [contentDuration, timelineDuration, dispatch])

  const togglePlay = useCallback(() => {
    if (playbackMode === 'forward') {
      stop()
    } else {
      play()
    }
  }, [playbackMode, stop, play])

  const toggleLoop = useCallback(() => {
    setIsLooping((prev) => !prev)
  }, [])

  const seekToStart = useCallback(() => {
    dispatch(new SetPlayheadCommand(0))
  }, [dispatch])

  const seekToEnd = useCallback(() => {
    const effectiveEnd = contentDuration > 0 ? contentDuration : timelineDuration
    dispatch(new SetPlayheadCommand(Math.max(0, effectiveEnd)))
  }, [contentDuration, timelineDuration, dispatch])

  const stepFrame = useCallback(
    (direction: 'prev' | 'next') => {
      stop()
      const safeFps = fps || 30
      const current = playheadRef.current
      const currentFrame = Math.round(current * safeFps)
      const targetFrame = direction === 'prev' ? Math.max(0, currentFrame - 1) : currentFrame + 1
      const effectiveEnd = contentDuration > 0 ? contentDuration : timelineDuration
      const target = Math.min(effectiveEnd, targetFrame / safeFps)
      dispatch(new SetPlayheadCommand(target))
    },
    [fps, contentDuration, timelineDuration, stop, dispatch]
  )

  const toggleFullscreen = useCallback(() => {
    const container = previewContainerRef?.current
    if (!container) return

    if (!document.fullscreenElement) {
      container
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {})
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {})
    }
  }, [previewContainerRef])

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Animation frame playback ticker
  useEffect(() => {
    if (playbackMode === 'stopped') {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
      lastTimeRef.current = null
      return
    }

    lastTimeRef.current = performance.now()
    const effectiveEnd = contentDuration > 0 ? contentDuration : timelineDuration

    function step(now: number) {
      if (!lastTimeRef.current) lastTimeRef.current = now
      const elapsed = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now

      const current = playheadRef.current

      if (playbackMode === 'forward') {
        const next = current + elapsed
        if (next >= effectiveEnd) {
          if (isLooping) {
            dispatch(new SetPlayheadCommand(0))
            animFrameRef.current = requestAnimationFrame(step)
          } else {
            dispatch(new SetPlayheadCommand(effectiveEnd))
            setPlaybackMode('stopped')
          }
        } else {
          dispatch(new SetPlayheadCommand(next))
          animFrameRef.current = requestAnimationFrame(step)
        }
      } else if (playbackMode === 'backward') {
        const next = current - elapsed
        if (next <= 0) {
          if (isLooping) {
            dispatch(new SetPlayheadCommand(effectiveEnd))
            animFrameRef.current = requestAnimationFrame(step)
          } else {
            dispatch(new SetPlayheadCommand(0))
            setPlaybackMode('stopped')
          }
        } else {
          dispatch(new SetPlayheadCommand(next))
          animFrameRef.current = requestAnimationFrame(step)
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(step)

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [playbackMode, isLooping, contentDuration, timelineDuration, dispatch])

  return {
    playbackMode,
    isLooping,
    isFullscreen,
    play,
    playBackwards,
    stop,
    togglePlay,
    toggleLoop,
    seekToStart,
    seekToEnd,
    stepFrame,
    toggleFullscreen,
  }
}
