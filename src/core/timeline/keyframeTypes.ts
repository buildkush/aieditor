export type KeyframeInterpolation = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold'

export interface Keyframe<T = number> {
  id: string
  time: number // Playhead timeline time in seconds
  value: T
  interpolation?: KeyframeInterpolation
}

export type PropertyKeyframeMap = Record<string, Keyframe<number>[]>

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'cropLeft'
  | 'cropRight'
  | 'cropTop'
  | 'cropBottom'
  | 'anchorX'
  | 'anchorY'
  | 'pitch'
  | 'yaw'
  | 'volume'
  | 'pan'
  | 'speed'
  | 'fontSize'
  | 'strokeWidth'
  | 'padding'
  | 'backgroundOpacity'
