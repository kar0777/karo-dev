import { ImageResponse } from 'next/og';
import { KARO_INNER_PATH, KARO_OUTER_PATH, KARO_STROKE_WIDTH } from '@/components/brand/logo';
import { siteConfig } from '@/lib/metadata';

/**
 * The social card.
 *
 * Rendered by Satori, which only understands a subset of CSS — flexbox,
 * absolute positioning, transforms and inline SVG. Notably it ships one
 * font weight, so the hierarchy here is built entirely from size,
 * colour and spacing rather than from bold text.
 */
export const runtime = 'nodejs';
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/* Design tokens, resolved to literals: Satori has no CSS custom properties. */
const BG = '#0d0b09';
const FG = '#f1f0ee';
const MUTED = '#a8a6a3';
const SUBTLE = '#7b7974';
const LINE = '#2a2825';
const JADE = '#54d2a8';

function Mark({
  px,
  stroke,
  fill,
  fillOpacity = 1,
  strokeOpacity = 1,
}: {
  px: number;
  stroke: string;
  fill: string;
  fillOpacity?: number;
  strokeOpacity?: number;
}) {
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none">
      <path
        d={KARO_OUTER_PATH}
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={KARO_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="miter"
      />
      <path d={KARO_INNER_PATH} fill={fill} fillOpacity={fillOpacity} />
    </svg>
  );
}

function Bullet() {
  return (
    <div
      style={{
        width: 7,
        height: 7,
        backgroundColor: SUBTLE,
        transform: 'rotate(45deg)',
      }}
    />
  );
}

export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: BG,
        color: FG,
        padding: '64px 72px',
        position: 'relative',
      }}
    >
      {/* Oversized mark bleeding off the right edge — the only ornament. */}
      <div style={{ display: 'flex', position: 'absolute', top: 96, right: -110 }}>
        <Mark px={520} stroke={LINE} fill={JADE} fillOpacity={0.09} />
      </div>

      {/* Lockup */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Mark px={46} stroke={FG} fill={JADE} />
        <div style={{ display: 'flex', fontSize: 40, letterSpacing: -1, marginLeft: 14 }}>
          Karo
        </div>
      </div>

      {/* Message */}
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 780 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 62,
            lineHeight: 1.12,
            letterSpacing: -2.2,
            color: FG,
          }}
        >
          {siteConfig.tagline}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 25,
            lineHeight: 1.45,
            letterSpacing: -0.3,
            color: MUTED,
            marginTop: 26,
          }}
        >
          A sandboxed Linux machine per project. Real shell, real files, real diffs — metered to
          the token.
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          borderTop: `1px solid ${LINE}`,
          paddingTop: 28,
          fontSize: 21,
          letterSpacing: -0.2,
          color: SUBTLE,
        }}
      >
        <div style={{ display: 'flex' }}>Sandboxed compute</div>
        <div style={{ display: 'flex', padding: '0 18px' }}>
          <Bullet />
        </div>
        <div style={{ display: 'flex' }}>MCP, skills &amp; plugins</div>
        <div style={{ display: 'flex', padding: '0 18px' }}>
          <Bullet />
        </div>
        <div style={{ display: 'flex' }}>Usage you can audit</div>
        <div style={{ display: 'flex', flexGrow: 1 }} />
        <div style={{ display: 'flex', color: MUTED }}>karo.dev</div>
      </div>
    </div>,
    { ...size },
  );
}
