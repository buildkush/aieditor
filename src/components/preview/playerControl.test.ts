import { describe, it, expect } from 'vitest'
import {
  SetPlayheadCommand,
} from '../../core/commands/editorCommand'
import { createEmptyProjectState } from '../../core/project/projectState'
import { CommandHistory } from '../../core/commands/commandHistory'

describe('Player Controls Behavior & Transport Logic', () => {
  const fps = 30
  const contentDuration = 24.5

  function setupPlayer() {
    const state = createEmptyProjectState()
    const history = new CommandHistory(state)
    let playheadTime = 10.0
    let playbackMode: 'forward' | 'backward' | 'stopped' = 'stopped'
    let isLooping = false

    const dispatch = (cmd: SetPlayheadCommand) => {
      history.execute(cmd)
      playheadTime = history.getCurrentState().playheadTime
    }

    const seekToStart = () => dispatch(new SetPlayheadCommand(0))
    const seekToEnd = () => dispatch(new SetPlayheadCommand(contentDuration))
    const stepNextFrame = () => {
      stop()
      const delta = 1 / fps
      dispatch(new SetPlayheadCommand(Math.min(contentDuration, playheadTime + delta)))
    }
    const stepPrevFrame = () => {
      stop()
      const delta = 1 / fps
      dispatch(new SetPlayheadCommand(Math.max(0, playheadTime - delta)))
    }
    const play = () => {
      if (playheadTime >= contentDuration) {
        dispatch(new SetPlayheadCommand(0))
      }
      playbackMode = 'forward'
    }
    const playBackwards = () => {
      if (playheadTime <= 0) {
        dispatch(new SetPlayheadCommand(contentDuration))
      }
      playbackMode = 'backward'
    }
    const stop = () => {
      playbackMode = 'stopped'
    }
    const toggleLoop = () => {
      isLooping = !isLooping
    }

    // Advance playback by elapsed seconds
    const tick = (elapsed: number) => {
      if (playbackMode === 'forward') {
        const next = playheadTime + elapsed
        if (next >= contentDuration) {
          if (isLooping) {
            dispatch(new SetPlayheadCommand(0))
          } else {
            dispatch(new SetPlayheadCommand(contentDuration))
            stop()
          }
        } else {
          dispatch(new SetPlayheadCommand(next))
        }
      } else if (playbackMode === 'backward') {
        const next = playheadTime - elapsed
        if (next <= 0) {
          if (isLooping) {
            dispatch(new SetPlayheadCommand(contentDuration))
          } else {
            dispatch(new SetPlayheadCommand(0))
            stop()
          }
        } else {
          dispatch(new SetPlayheadCommand(next))
        }
      }
    }

    return {
      getPlayhead: () => playheadTime,
      getMode: () => playbackMode,
      getIsLooping: () => isLooping,
      seekToStart,
      seekToEnd,
      stepNextFrame,
      stepPrevFrame,
      play,
      playBackwards,
      stop,
      toggleLoop,
      tick,
      history,
    }
  }

  it('Start: sets playhead to 0 without adding to undo history', () => {
    const player = setupPlayer()
    player.seekToStart()
    expect(player.getPlayhead()).toBe(0)
    expect(player.history.undoCount).toBe(0)
  })

  it('End: sets playhead to content duration without adding to undo history', () => {
    const player = setupPlayer()
    player.seekToEnd()
    expect(player.getPlayhead()).toBe(contentDuration)
    expect(player.history.undoCount).toBe(0)
  })

  it('Next Frame: moves playhead forward by exactly 1 frame (1/fps)', () => {
    const player = setupPlayer()
    const initial = player.getPlayhead()
    player.stepNextFrame()
    expect(player.getPlayhead()).toBeCloseTo(initial + 1 / fps, 4)
    expect(player.getMode()).toBe('stopped')
    expect(player.history.undoCount).toBe(0)
  })

  it('Previous Frame: moves playhead backward by exactly 1 frame', () => {
    const player = setupPlayer()
    const initial = player.getPlayhead()
    player.stepPrevFrame()
    expect(player.getPlayhead()).toBeCloseTo(initial - 1 / fps, 4)
    expect(player.getMode()).toBe('stopped')
    expect(player.history.undoCount).toBe(0)
  })

  it('Stop: pauses playback without setting playhead to zero', () => {
    const player = setupPlayer()
    player.play()
    expect(player.getMode()).toBe('forward')

    player.tick(2.0)
    expect(player.getPlayhead()).toBeCloseTo(12.0, 4)

    player.stop()
    expect(player.getMode()).toBe('stopped')
    // Playhead stays at 12.0, NEVER reset to 0
    expect(player.getPlayhead()).toBeCloseTo(12.0, 4)
  })

  it('Play Backwards: rewinds continuously and halts at 0 when not looping', () => {
    const player = setupPlayer()
    player.playBackwards()
    expect(player.getMode()).toBe('backward')

    player.tick(3.0)
    expect(player.getPlayhead()).toBeCloseTo(7.0, 4)

    // Tick past beginning
    player.tick(10.0)
    expect(player.getPlayhead()).toBe(0)
    expect(player.getMode()).toBe('stopped')
  })

  it('Loop: loops to start on reaching end when forward playing', () => {
    const player = setupPlayer()
    player.toggleLoop()
    expect(player.getIsLooping()).toBe(true)

    player.play()
    player.tick(20.0) // Past contentDuration (24.5)
    expect(player.getPlayhead()).toBe(0)
    expect(player.getMode()).toBe('forward')
  })
})
