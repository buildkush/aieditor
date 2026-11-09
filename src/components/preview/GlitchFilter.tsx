import type { GlitchVisual } from '../../core/playback/transitionEvaluation'

/** Apply tearing, channel separation and static to the actual composited image. */
export function GlitchFilter({ id, glitch }: { id: string; glitch: GlitchVisual }) {
  return <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
    <defs>
      <filter id={id} x="-20%" y="-5%" width="140%" height="110%" colorInterpolationFilters="sRGB">
        {/* Zero horizontal frequency produces displaced horizontal signal bands. */}
        <feTurbulence type="turbulence" baseFrequency="0 0.07" numOctaves="1" seed={glitch.seed} result="bandNoise" />
        <feComponentTransfer in="bandNoise" result="bands">
          <feFuncR type="discrete" tableValues="0 0.5 0.5 1" />
          <feFuncG type="linear" slope="0" intercept="0.5" />
        </feComponentTransfer>
        <feDisplacementMap in="SourceGraphic" in2="bands" scale={glitch.displacement} xChannelSelector="R" yChannelSelector="G" result="torn" />
        <feOffset in="torn" dx={glitch.rgbOffset} result="redOffset" />
        <feColorMatrix in="redOffset" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
        <feColorMatrix in="torn" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
        <feOffset in="torn" dx={-glitch.rgbOffset} result="blueOffset" />
        <feColorMatrix in="blueOffset" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
        <feBlend in="red" in2="green" mode="screen" result="redGreen" />
        <feBlend in="redGreen" in2="blue" mode="screen" result="split" />
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed={glitch.seed + 97} result="staticNoise" />
        <feColorMatrix in="staticNoise" type="saturate" values="0" result="monoNoise" />
        <feComponentTransfer in="monoNoise" result="grain">
          <feFuncA type="linear" slope="0" intercept={glitch.noiseOpacity} />
        </feComponentTransfer>
        <feComposite in="grain" in2="split" operator="in" result="maskedGrain" />
        <feComposite in="maskedGrain" in2="split" operator="over" />
      </filter>
    </defs>
  </svg>
}
