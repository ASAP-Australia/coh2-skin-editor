/**
 * CssGradientBackground — pure-CSS fallback for ShaderWaveBackground.
 *
 * Renders instantly on first paint (no JS/WebGL required). Used as the
 * Suspense fallback while Three.js loads asynchronously. The colour
 * palette matches the shader: dark charcoal base (#212121) with subtle
 * lighter peaks (#262629), using the same approximate luminance range
 * as the fragment shader's baseColor/peakColor mix.
 *
 * A slow radial drift animation keeps it from feeling completely static
 * without the cost of a WebGL render loop.
 */
export default function CssGradientBackground() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{ backgroundColor: '#212121' }}
      >
        {/* Subtle animated radial gradients mimicking the wave shader's
            elevation peaks — one drifts slow-left, one drift slow-right,
            giving a gentle breathing effect on first paint. */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 60% 50% at 30% 60%, rgba(38,38,41,0.9), transparent 70%),
              radial-gradient(ellipse 50% 40% at 70% 40%, rgba(36,36,40,0.7), transparent 65%)
            `,
            animation: 'cssGradBgDrift 14s ease-in-out infinite',
          }}
        />
      </div>
      <style>{`
        @keyframes cssGradBgDrift {
          0%   { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(-18px, 10px) scale(1.03); }
          66%  { transform: translate(12px, -8px) scale(0.98); }
          100% { transform: translate(0, 0) scale(1); }
        }
      `}</style>
    </>
  )
}
