// אייקוני קו מינימליסטיים — בהשראת העיצוב מ-Claude Design.
// SVG בצבע הטקסט הנוכחי (currentColor), נראים זהים בכל מכשיר —
// בניגוד לאימוג'י שמתרנדר שונה בין iOS/אנדרואיד/ווינדוס.

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

export function TrendDownIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M4 20 H20" />
      <path d="M4.5 6.5 L9.5 11.5 L13 8.5 L19.5 15.5" />
      <path d="M19.5 11.5 V15.5 H15.5" />
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

export function TargetIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function TrophyIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M8 4 H16 V9.5 A4 4 0 0 1 8 9.5 Z" />
      <path d="M8 5.5 H5.5 A2.5 2.5 0 0 0 8 9" />
      <path d="M16 5.5 H18.5 A2.5 2.5 0 0 1 16 9" />
      <path d="M12 13.5 V16.5" />
      <path d="M8.5 20 H15.5 M10 20 C10 17.8 14 17.8 14 20" />
    </svg>
  );
}

export function BellIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M6 17 C7.5 15.5, 7 9.5, 8.5 7.5 C10 5.5, 14 5.5, 15.5 7.5 C17 9.5, 16.5 15.5, 18 17 Z" />
      <path d="M10.2 19.5 A2 2 0 0 0 13.8 19.5" />
    </svg>
  );
}

export function SaveIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 4 V13.5" />
      <path d="M8.5 10.5 L12 14 L15.5 10.5" />
      <path d="M4.5 15.5 V18 A1.5 1.5 0 0 0 6 19.5 H18 A1.5 1.5 0 0 0 19.5 18 V15.5" />
    </svg>
  );
}

export function TimerIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 13.5 V9.5" />
      <path d="M10 3.5 H14" />
      <path d="M12 3.5 V6" />
    </svg>
  );
}

export function BrainIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M11 4.5 A3 3 0 0 0 7 7 A3.2 3.2 0 0 0 5 10 A3.2 3.2 0 0 0 6.5 13 A3 3 0 0 0 8 18 A3 3 0 0 0 11 19.5 Z" />
      <path d="M13 4.5 A3 3 0 0 1 17 7 A3.2 3.2 0 0 1 19 10 A3.2 3.2 0 0 1 17.5 13 A3 3 0 0 1 16 18 A3 3 0 0 1 13 19.5 Z" />
      <path d="M11 4.5 V19.5 M13 4.5 V19.5" />
    </svg>
  );
}

export function SearchIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15 L20 20" />
    </svg>
  );
}

export function FlameIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 3.5 C13 7, 17.5 8.5, 17.5 13.5 A5.5 5.5 0 0 1 6.5 13.5 C6.5 10.5, 8.5 9, 9.5 6.5 C10.5 8, 11.5 8.5, 12 3.5 Z" />
      <path d="M12 20 A2.8 2.8 0 0 0 14.8 16.5 C14.4 14.5, 12.8 14, 12 12.5 C11.2 14, 9.6 14.5, 9.2 16.5 A2.8 2.8 0 0 0 12 20 Z" />
    </svg>
  );
}

export function BoltIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M13 3.5 L6 13.5 H11 L10 20.5 L17.5 10 H12.5 Z" />
    </svg>
  );
}

export function EditIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M14.5 5.5 L18.5 9.5 L9 19 H5 V15 Z" />
      <path d="M12.8 7.2 L16.8 11.2" />
    </svg>
  );
}

export function TrashIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M5 7 H19" />
      <path d="M9.5 7 V4.5 H14.5 V7" />
      <path d="M6.5 7 L7.5 19.5 H16.5 L17.5 7" />
      <path d="M10 10.5 V16 M14 10.5 V16" />
    </svg>
  );
}

export function PlusIcon({ size = 24, strokeWidth = 1.9 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 5 V19 M5 12 H19" />
    </svg>
  );
}

export function StarIcon({ size = 24, strokeWidth = 1.7, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 4 L14.4 9 L19.8 9.7 L15.9 13.5 L16.9 18.9 L12 16.3 L7.1 18.9 L8.1 13.5 L4.2 9.7 L9.6 9 Z" />
    </svg>
  );
}

export function UndoIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M8.5 6 L4.5 10 L8.5 14" />
      <path d="M4.5 10 H14 A5 5 0 0 1 14 20 H9" />
    </svg>
  );
}

export function TasteIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M4 9 C8 13.5, 16 13.5, 20 9" />
      <path d="M9 11.8 V13.5 A3 3 0 0 0 15 13.5 V11.8" />
    </svg>
  );
}

export function SoapIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="9" cy="14" r="5.5" />
      <circle cx="16.5" cy="8" r="3" />
      <circle cx="19" cy="14.5" r="1.6" />
    </svg>
  );
}

export function ToolsIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M13.5 6.5 A4 4 0 0 1 19 10.8 L10.8 19 A2 2 0 0 1 8 16.2 L16.2 8 A4 4 0 0 1 13.5 6.5 Z" transform="rotate(90 13.5 12.75)" />
      <path d="M5 5 L9.5 9.5" />
      <path d="M4.5 8 L4.5 4.5 L8 4.5" />
    </svg>
  );
}

export function UserIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M5 20 C5.5 15.8, 8.5 14.5, 12 14.5 C15.5 14.5, 18.5 15.8, 19 20" />
    </svg>
  );
}

export function CheckIcon({ size = 24, strokeWidth = 1.9 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M5 12.5 L10 17.5 L19 6.5" />
    </svg>
  );
}

export function SunIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M18.4 5.6 L17 7 M7 17 L5.6 18.4" />
    </svg>
  );
}

export function MoonIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M19.5 14 A8 8 0 1 1 10 4.5 A6.5 6.5 0 0 0 19.5 14 Z" />
    </svg>
  );
}

export function LeafIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M19 5 C10 5, 5.5 9.5, 5.5 15.5 C5.5 17.5, 6.5 19, 6.5 19 C11 19, 19 17, 19 5 Z" />
      <path d="M6.5 19 C9 13.5, 13 9.5, 17 7" />
    </svg>
  );
}

export function ClipboardIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <rect x="5.5" y="5" width="13" height="15.5" rx="2" />
      <path d="M9.5 5 A2.5 2.5 0 0 1 14.5 5 V6.5 H9.5 Z" />
      <path d="M9 11 H15 M9 14.5 H13.5" />
    </svg>
  );
}

export function CoinIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 8.5 V13 A2.5 2.5 0 0 0 14.5 13" />
      <path d="M14.5 15.5 V11 A2.5 2.5 0 0 0 9.5 11" opacity="0.55" />
    </svg>
  );
}

export function GiftIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <rect x="4.5" y="8" width="15" height="4" rx="1" />
      <path d="M6 12 V19.5 H18 V12" />
      <path d="M12 8 V19.5" />
      <path d="M12 8 C8.5 8, 7.5 4.5, 9.8 4.5 C11.5 4.5, 12 6.5, 12 8 C12 6.5, 12.5 4.5, 14.2 4.5 C16.5 4.5, 15.5 8, 12 8 Z" />
    </svg>
  );
}

export function ScaleIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 4.5 V19.5 M8.5 19.5 H15.5" />
      <path d="M4.5 7 H19.5" />
      <path d="M6.5 7 L4.5 12.5 A2.5 2 0 0 0 8.5 12.5 Z" />
      <path d="M17.5 7 L15.5 12.5 A2.5 2 0 0 0 19.5 12.5 Z" />
    </svg>
  );
}

export function GearIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5 V6 M12 18 V20.5 M3.5 12 H6 M18 12 H20.5 M6 6 L7.8 7.8 M16.2 16.2 L18 18 M18 6 L16.2 7.8 M7.8 16.2 L6 18" />
    </svg>
  );
}

export function MedalIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="14.5" r="5.5" />
      <path d="M9.5 10 L7 3.5 M14.5 10 L17 3.5" />
      <path d="M12 12.2 L12.9 14 L14.8 14.2 L13.4 15.6 L13.7 17.5 L12 16.6 L10.3 17.5 L10.6 15.6 L9.2 14.2 L11.1 14 Z" strokeWidth="1.2" />
    </svg>
  );
}

export function BulbIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M8 15 C5.5 13, 5 8, 8.5 5.8 C11 4.2, 14.5 4.6, 16.2 7 C18 9.5, 17 13.2, 16 15 C15.2 16.2, 15 17, 15 18 H9 C9 17, 8.8 16.2, 8 15 Z" />
      <path d="M9.5 20.5 H14.5" />
    </svg>
  );
}

export function PackageIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M4.5 8 L12 4 L19.5 8 V16 L12 20 L4.5 16 Z" />
      <path d="M4.5 8 L12 12 L19.5 8" />
      <path d="M12 12 V20" />
    </svg>
  );
}

export function WarnIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <path d="M12 4.5 L20.5 19 H3.5 Z" />
      <path d="M12 10 V14" />
      <circle cx="12" cy="16.6" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function CalendarIcon({ size = 24, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...svgProps(size)} strokeWidth={strokeWidth}>
      <rect x="4.5" y="5.5" width="15" height="14.5" rx="2" />
      <path d="M8.5 3.5 V7 M15.5 3.5 V7 M4.5 10 H19.5" />
    </svg>
  );
}
