import type { TextProperties } from '../../core/timeline/types'

export interface TextToolPreset {
  id: string
  name: string
  subtitle?: string
  itemKind: 'text' | 'caption'
  duration: number
  text: string
  properties?: Partial<TextProperties>
  transform?: {
    position?: { x: number; y: number }
    scale?: number
    rotation?: number
    opacity?: number
  }
  captionPreset?: string
  captionStyle?: Partial<TextProperties>
}

export const TEXT_TOOL_PRESETS: TextToolPreset[] = [
  {
    id: 'text',
    name: 'Text',
    subtitle: 'Creative Title',
    itemKind: 'text',
    duration: 5,
    text: 'Text',
    properties: {
      fontFamily: 'Inter, sans-serif',
      fontSize: 54,
      fontWeight: '600',
      color: '#ffffff',
      align: 'center',
    },
    transform: {
      position: { x: 0, y: 0 },
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
  },
  {
    id: 'heading',
    name: 'Heading',
    subtitle: 'Display Header',
    itemKind: 'text',
    duration: 5,
    text: 'HEADING',
    properties: {
      fontFamily: 'Inter, sans-serif',
      fontSize: 76,
      fontWeight: '800',
      color: '#ffffff',
      align: 'center',
      letterSpacing: 2,
      shadowColor: 'rgba(0, 0, 0, 0.85)',
      shadowBlur: 10,
      shadowOffsetY: 4,
    },
    transform: {
      position: { x: 0, y: -60 },
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
  },
  {
    id: 'corner-label',
    name: 'Corner Label',
    subtitle: 'Top Corner Tag',
    itemKind: 'text',
    duration: 5,
    text: 'LIVE',
    properties: {
      fontFamily: 'Inter, sans-serif',
      fontSize: 24,
      fontWeight: '700',
      color: '#ffffff',
      align: 'left',
      backgroundColor: 'rgba(239, 68, 68, 0.9)',
      backgroundOpacity: 0.9,
      padding: 8,
    },
    transform: {
      position: { x: -380, y: -220 },
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
  },
  {
    id: 'lower-third',
    name: 'Lower Third',
    subtitle: 'Name & Lower Bar',
    itemKind: 'text',
    duration: 5,
    text: 'Lower Third Title',
    properties: {
      fontFamily: 'Inter, sans-serif',
      fontSize: 34,
      fontWeight: '700',
      color: '#ffffff',
      align: 'left',
      backgroundColor: 'rgba(15, 23, 42, 0.88)',
      backgroundOpacity: 0.88,
      padding: 12,
      strokeColor: '#38bdf8',
      strokeWidth: 1,
    },
    transform: {
      position: { x: -220, y: 180 },
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
  },
  {
    id: 'subtitle',
    name: 'Subtitle',
    subtitle: 'Caption Cue',
    itemKind: 'caption',
    duration: 3,
    text: 'Subtitle cue',
    captionPreset: 'Clean',
    captionStyle: {
      fontFamily: 'Inter, sans-serif',
      fontSize: 44,
      fontWeight: '600',
      color: '#ffffff',
      align: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      backgroundOpacity: 0.65,
      padding: 8,
    },
    transform: {
      position: { x: 0, y: 190 },
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
  },
  {
    id: 'animated-caption',
    name: 'Animated Caption',
    subtitle: 'Word Highlight Pop',
    itemKind: 'caption',
    duration: 3,
    text: 'Dynamic word animation caption',
    captionPreset: 'Highlight',
    captionStyle: {
      fontFamily: 'Montserrat, Inter, sans-serif',
      fontSize: 50,
      fontWeight: '800',
      color: '#000000',
      align: 'center',
      backgroundColor: '#00F0FF',
      backgroundOpacity: 1,
      padding: 10,
    },
    transform: {
      position: { x: 0, y: 180 },
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
  },
]
