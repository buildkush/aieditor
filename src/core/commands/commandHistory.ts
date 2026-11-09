import type { ProjectState } from '../project/projectState'
import type { EditorCommand } from './editorCommand'

export interface CommandHistoryOptions {
  /**
   * Maximum number of undo states to retain.
   * Default is 100.
   */
  maxHistorySize?: number
}

/**
 * CommandHistory manages undo/redo history for ProjectState.
 *
 * Rules:
 * 1. ProjectState is the single source of truth.
 * 2. Executing a new command after undo clears the redo stack.
 * 3. Undo restores the exact previous ProjectState.
 * 4. Redo restores the state produced by the undone command.
 * 5. Historical states are never mutated (immutable transitions).
 */
export class CommandHistory {
  private currentState: ProjectState
  private undoStack: ProjectState[] = []
  private redoStack: ProjectState[] = []
  private lastMergeKey: string | null = null
  private readonly maxHistorySize: number

  constructor(initialState: ProjectState, options?: CommandHistoryOptions) {
    this.currentState = initialState
    this.maxHistorySize = options?.maxHistorySize ?? 100
  }

  getCurrentState(): ProjectState {
    return this.currentState
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoCount(): number {
    return this.undoStack.length
  }

  get redoCount(): number {
    return this.redoStack.length
  }

  clearMergeKey(): void {
    this.lastMergeKey = null
  }

  /**
   * Executes a command on the current state.
   * If the command is not undoable (e.g. playhead navigation), updates state
   * without polluting the undo stack or clearing the redo stack.
   * If the command specifies a mergeKey matching the previous command,
   * updates the current state without pushing an additional undo step,
   * enabling continuous real-time updates while preserving 1 clean undo step.
   */
  execute(command: EditorCommand): ProjectState {
    const nextState = command.execute(this.currentState)
    if (command.isUndoable === false) {
      this.currentState = nextState
      return this.currentState
    }

    if (
      command.mergeKey &&
      this.lastMergeKey === command.mergeKey &&
      this.undoStack.length > 0
    ) {
      this.currentState = nextState
      this.redoStack = []
      return this.currentState
    }

    this.undoStack.push(this.currentState)
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift()
    }
    this.lastMergeKey = command.mergeKey ?? null
    this.currentState = nextState
    this.redoStack = []
    return this.currentState
  }

  /**
   * Restores the previous ProjectState.
   * Preserves the active playhead position so editing undo never jumps the playhead.
   */
  undo(): ProjectState | null {
    this.lastMergeKey = null
    if (!this.canUndo()) {
      return null
    }
    const currentPlayhead = this.currentState.playheadTime
    const previousState = this.undoStack.pop()!
    this.redoStack.push(this.currentState)
    this.currentState = {
      ...previousState,
      playheadTime: currentPlayhead,
    }
    return this.currentState
  }

  /**
   * Restores the state produced by the undone command.
   * Preserves the active playhead position across redo.
   */
  redo(): ProjectState | null {
    this.lastMergeKey = null
    if (!this.canRedo()) {
      return null
    }
    const currentPlayhead = this.currentState.playheadTime
    const nextState = this.redoStack.pop()!
    this.undoStack.push(this.currentState)
    this.currentState = {
      ...nextState,
      playheadTime: currentPlayhead,
    }
    return this.currentState
  }

  /**
   * Clears the undo and redo stacks, retaining the current state.
   */
  clear(): void {
    this.lastMergeKey = null
    this.undoStack = []
    this.redoStack = []
  }
}

export const EditorHistory = CommandHistory
export type EditorHistory = CommandHistory
