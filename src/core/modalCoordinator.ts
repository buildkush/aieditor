/**
 * Modal dialog single-flight / busy guard and interaction lock coordinator.
 * Ensures only ONE native dialog/picker or modal operation can be active at a time,
 * prevents repeated clicks from opening multiple dialogs, and blocks background
 * editor interactions while a modal operation is active.
 */

type ModalStateListener = (isBlocked: boolean) => void

class ModalCoordinator {
  private isBusy = false
  private activeOperation: string | null = null
  private listeners = new Set<ModalStateListener>()

  /**
   * Returns true if any modal dialog/picker operation is currently active.
   */
  getIsBlocked(): boolean {
    return this.isBusy
  }

  getActiveOperation(): string | null {
    return this.activeOperation
  }

  subscribe(listener: ModalStateListener): () => void {
    this.listeners.add(listener)
    listener(this.isBusy)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.isBusy)
    }
  }

  /**
   * Executes an asynchronous modal operation with single-flight locking.
   * If an operation is already active, subsequent requests return null immediately.
   */
  async runExclusive<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T | null> {
    if (this.isBusy) {
      console.warn(`[ModalCoordinator] Blocked attempt to open '${operationName}' because '${this.activeOperation}' is already active.`)
      return null
    }

    this.isBusy = true
    this.activeOperation = operationName
    this.notify()

    try {
      return await operation()
    } finally {
      this.isBusy = false
      this.activeOperation = null
      this.notify()
      // Give focus back to the window if available
      if (typeof window !== 'undefined') {
        window.focus()
      }
    }
  }
}

export const modalCoordinator = new ModalCoordinator()
