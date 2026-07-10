// אייקוני קו מינימליסטיים לניווט — בהשראת העיצוב מ-Claude Design.
// SVG בצבע הטקסט הנוכחי (currentColor), נראים זהים בכל מכשיר.

interface IconProps {
  size?: number;
  strokeWidth?: number;
}

const svgProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function HomeIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M3.5 11 L12 4 L20.5 11" />
      <path d="M5.5 9.5 V19.5 H18.5 V9.5" />
      <path d="M10 19.5 V14.5 H14 V19.5" />
    </svg>
  );
}

export function JournalIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 3.5 V20.5" />
      <path d="M12.5 8 H16" />
      <path d="M12.5 11.5 H16" />
    </svg>
  );
}

export function TrendIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M4 20 H20" />
      <path d="M4.5 15.5 L9.5 10.5 L13 13.5 L19.5 6.5" />
      <path d="M15.5 6.5 H19.5 V10.5" />
    </svg>
  );
}

export function BeanIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <g transform="rotate(28 12 12)">
        <ellipse cx="12" cy="12" rx="5.6" ry="8.4" />
        <path d="M12 4.2 C 9.2 8.4, 14.8 15.6, 12 19.8" />
      </g>
    </svg>
  );
}

export function ChartIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M4 20 H20" />
      <path d="M7 20 V13" />
      <path d="M12 20 V7.5" />
      <path d="M17 20 V10.5" />
    </svg>
  );
}

export function SettingsIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M4.5 7.5 H19.5" />
      <circle cx="9.5" cy="7.5" r="2.1" fill="var(--bg-elevated)" />
      <path d="M4.5 16.5 H19.5" />
      <circle cx="15" cy="16.5" r="2.1" fill="var(--bg-elevated)" />
    </svg>
  );
}

export function CupIcon({ size = 26, strokeWidth = 1.9 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M5 10 H15.5 V14.5 A4.5 4.5 0 0 1 11 19 H9.5 A4.5 4.5 0 0 1 5 14.5 Z" />
      <path d="M15.5 11 H17.2 A2.4 2.4 0 0 1 17.2 15.8 H15.5" />
      <path d="M8.2 4 C 7.6 5.2, 8.6 6, 8.2 7.2" />
      <path d="M12 4 C 11.4 5.2, 12.4 6, 12 7.2" />
    </svg>
  );
}
