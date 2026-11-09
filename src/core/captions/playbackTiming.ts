/** Bound media drift in project seconds, including retimed source clips. */
export function captionPlaybackTolerance(hasCaptions: boolean, speed: number): number {
  return hasCaptions ? .06 * Math.max(.25, Math.min(4, speed)) : .25
}
