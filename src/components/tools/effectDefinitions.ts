export interface EffectParamDef {
  key: string
  label: string
  type: 'number' | 'color' | 'select'
  min?: number
  max?: number
  step?: number
  defaultVal: number | string | boolean
  unit?: string
  options?: { value: string; label: string }[]
}

export interface EffectDefinition {
  id: string
  name: string
  category: 'video' | 'color' | 'stylize' | 'distortion' | 'keying' | 'audio'
  icon: string
  description: string
  params: EffectParamDef[]
}

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  // 1. VIDEO
  {
    id: 'blur',
    name: 'Blur',
    category: 'video',
    icon: '💧',
    description: 'Smooth gaussian softening for backgrounds or defocus',
    params: [
      { key: 'radius', label: 'Radius', type: 'number', min: 0, max: 100, step: 0.5, defaultVal: 10, unit: 'px' },
    ],
  },
  {
    id: 'sharpen',
    name: 'Sharpen',
    category: 'video',
    icon: '🔍',
    description: 'Edge enhancement and micro-contrast clarity',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, step: 1, defaultVal: 25, unit: '%' },
    ],
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    category: 'video',
    icon: '⚪',
    description: 'Monochrome desaturation conversion',
    params: [
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, step: 1, defaultVal: 100, unit: '%' },
    ],
  },
  {
    id: 'vignette',
    name: 'Vignette',
    category: 'video',
    icon: '⭕',
    description: 'Cinematic edge darkening to draw focus inward',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, step: 1, defaultVal: 50, unit: '%' },
      { key: 'radius', label: 'Radius', type: 'number', min: 10, max: 100, step: 1, defaultVal: 75, unit: '%' },
    ],
  },

  // 2. COLOR
  {
    id: 'brightness',
    name: 'Brightness',
    category: 'color',
    icon: '☀️',
    description: 'Luminance offset across image tones',
    params: [
      { key: 'value', label: 'Brightness', type: 'number', min: -100, max: 100, step: 1, defaultVal: 0 },
    ],
  },
  {
    id: 'contrast',
    name: 'Contrast',
    category: 'color',
    icon: '🌓',
    description: 'Tonal separation between shadows and highlights',
    params: [
      { key: 'value', label: 'Contrast', type: 'number', min: -100, max: 100, step: 1, defaultVal: 0 },
    ],
  },
  {
    id: 'saturation',
    name: 'Saturation',
    category: 'color',
    icon: '🎨',
    description: 'Color vividness and purity intensity',
    params: [
      { key: 'value', label: 'Saturation', type: 'number', min: 0, max: 200, step: 1, defaultVal: 100, unit: '%' },
    ],
  },
  {
    id: 'exposure',
    name: 'Exposure',
    category: 'color',
    icon: '🔆',
    description: 'Photographic exposure adjustment in EV stops',
    params: [
      { key: 'ev', label: 'EV', type: 'number', min: -5, max: 5, step: 0.1, defaultVal: 0, unit: 'EV' },
    ],
  },
  {
    id: 'temperature',
    name: 'Temperature',
    category: 'color',
    icon: '🌡️',
    description: 'White balance temperature adjustment in Kelvin',
    params: [
      { key: 'kelvin', label: 'Kelvin', type: 'number', min: 2000, max: 10000, step: 50, defaultVal: 6500, unit: 'K' },
    ],
  },
  {
    id: 'tint',
    name: 'Tint',
    category: 'color',
    icon: '🧪',
    description: 'Green / magenta chromatic shift balance',
    params: [
      { key: 'amount', label: 'Tint', type: 'number', min: -100, max: 100, step: 1, defaultVal: 0 },
    ],
  },

  // 3. STYLIZE
  {
    id: 'glow',
    name: 'Glow',
    category: 'stylize',
    icon: '✨',
    description: 'Luminous diffusion around highlights',
    params: [
      { key: 'radius', label: 'Radius', type: 'number', min: 0, max: 100, step: 1, defaultVal: 20, unit: 'px' },
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, step: 1, defaultVal: 50, unit: '%' },
    ],
  },
  {
    id: 'rgb-split',
    name: 'RGB Split',
    category: 'stylize',
    icon: '🌈',
    description: 'Chromatic aberration offset between color channels',
    params: [
      { key: 'distance', label: 'Offset', type: 'number', min: 0, max: 50, step: 0.5, defaultVal: 5, unit: 'px' },
    ],
  },
  {
    id: 'vhs',
    name: 'VHS',
    category: 'stylize',
    icon: '📼',
    description: 'Retro magnetic tape distortion and grain',
    params: [
      { key: 'noise', label: 'Noise', type: 'number', min: 0, max: 100, step: 1, defaultVal: 35, unit: '%' },
    ],
  },
  {
    id: 'pixelate',
    name: 'Pixelate',
    category: 'stylize',
    icon: '🔲',
    description: 'Mosaic downsampling block resolution',
    params: [
      { key: 'size', label: 'Block Size', type: 'number', min: 2, max: 64, step: 1, defaultVal: 8, unit: 'px' },
    ],
  },

  // 4. DISTORTION
  {
    id: 'shake',
    name: 'Shake',
    category: 'distortion',
    icon: '〰️',
    description: 'Handheld camera organic jitter',
    params: [
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, step: 1, defaultVal: 15, unit: '%' },
      { key: 'speed', label: 'Frequency', type: 'number', min: 1, max: 30, step: 1, defaultVal: 10, unit: 'Hz' },
    ],
  },
  {
    id: 'wave',
    name: 'Wave',
    category: 'distortion',
    icon: '🌊',
    description: 'Sinusoidal spatial ripple wave displacement',
    params: [
      { key: 'amplitude', label: 'Amplitude', type: 'number', min: 0, max: 100, step: 1, defaultVal: 20, unit: 'px' },
      { key: 'frequency', label: 'Frequency', type: 'number', min: 1, max: 20, step: 0.5, defaultVal: 5 },
    ],
  },
  {
    id: 'lens-distortion',
    name: 'Lens Distortion',
    category: 'distortion',
    icon: '🌐',
    description: 'Barrel and pincushion spherical curvature',
    params: [
      { key: 'curvature', label: 'Curvature', type: 'number', min: -100, max: 100, step: 1, defaultVal: 25, unit: '%' },
    ],
  },

  // 5. KEYING
  {
    id: 'chroma-key',
    name: 'Chroma Key',
    category: 'keying',
    icon: '🟩',
    description: 'Green screen / blue screen background transparency',
    params: [
      { key: 'keyColor', label: 'Key Color', type: 'color', defaultVal: '#00ff00' },
      { key: 'tolerance', label: 'Tolerance', type: 'number', min: 0, max: 100, step: 1, defaultVal: 35, unit: '%' },
      { key: 'smoothness', label: 'Smoothness', type: 'number', min: 0, max: 100, step: 1, defaultVal: 10, unit: '%' },
    ],
  },

  // 6. AUDIO
  {
    id: 'gain',
    name: 'Gain',
    category: 'audio',
    icon: '🔊',
    description: 'Linear audio gain boost or attenuation',
    params: [
      { key: 'gain', label: 'Gain', type: 'number', min: -60, max: 24, step: 0.5, defaultVal: 0, unit: 'dB' },
    ],
  },
  {
    id: 'eq',
    name: 'EQ',
    category: 'audio',
    icon: '🎚️',
    description: '3-band parametric frequency equalizer',
    params: [
      { key: 'bass', label: 'Bass', type: 'number', min: -24, max: 24, step: 0.5, defaultVal: 0, unit: 'dB' },
      { key: 'mid', label: 'Mid', type: 'number', min: -24, max: 24, step: 0.5, defaultVal: 0, unit: 'dB' },
      { key: 'treble', label: 'Treble', type: 'number', min: -24, max: 24, step: 0.5, defaultVal: 0, unit: 'dB' },
    ],
  },
  {
    id: 'compressor',
    name: 'Compressor',
    category: 'audio',
    icon: '🎛️',
    description: 'Dynamic range compressor and limiter',
    params: [
      { key: 'threshold', label: 'Threshold', type: 'number', min: -60, max: 0, step: 0.5, defaultVal: -20, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', type: 'number', min: 1, max: 20, step: 0.5, defaultVal: 4, unit: ':1' },
    ],
  },
]

export function getEffectDefinition(id: string): EffectDefinition | undefined {
  return EFFECT_DEFINITIONS.find((e) => e.id === id)
}
