import { useEffect, useState } from 'react'
import { modalCoordinator } from '../core/modalCoordinator'

/**
 * Hook returning whether any native picker or modal dialog is currently active.
 */
export function useModalBlocked(): boolean {
  const [isBlocked, setIsBlocked] = useState(modalCoordinator.getIsBlocked())

  useEffect(() => {
    return modalCoordinator.subscribe(setIsBlocked)
  }, [])

  return isBlocked
}
