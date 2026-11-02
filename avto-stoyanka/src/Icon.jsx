// Premium ikonkalar: oltin gradientli chiziqlar, bir xil qalinlik va burchaklar
import { useId } from 'react';

const PATHS = {
  crown: 'M3 17 L5 7 L9.5 11 L12 5 L14.5 11 L19 7 L21 17 Z M3 20 H21',
  search: 'M10.5 4 a6.5 6.5 0 1 0 0.01 0 Z M15.5 15.5 L21 21',
  scan: 'M3 8 V4 H7 M17 4 H21 V8 M21 16 V20 H17 M7 20 H3 V16 M7 12 H17',
  camera: 'M3 8 H7 L9 5 H15 L17 8 H21 V19 H3 Z M12 10 a3.5 3.5 0 1 0 0.01 0 Z',
  car: 'M4 16 V12 L6.5 7 H17.5 L20 12 V16 Z M4 12 H20 M7 16 V18.5 M17 16 V18.5 M7.5 14 h0.5 M16 14 h0.5',
  ticket: 'M4 6 H20 V10 a2 2 0 0 0 0 4 V18 H4 V14 a2 2 0 0 0 0 -4 Z M14 6 V18',
  print: 'M7 9 V4 H17 V9 M5 9 H19 V16 H17 M7 16 H5 V9 M7 13 H17 V21 H7 Z',
  check: 'M4 12.5 L9.5 18 L20 6',
  close: 'M6 6 L18 18 M18 6 L6 18',
  warning: 'M12 3 L22 20 H2 Z M12 9 V14 M12 17 v0.5',
  drop: 'M12 3 C9 8 6 11 6 14.5 a6 6 0 0 0 12 0 C18 11 15 8 12 3 Z',
  pin: 'M12 21 C8 16 5 12.5 5 9 a7 7 0 0 1 14 0 C19 12.5 16 16 12 21 Z M12 6.5 a2.5 2.5 0 1 0 0.01 0 Z',
  diamond: 'M6 4 H18 L22 9 L12 21 L2 9 Z M2 9 H22 M9 4 L12 9 L15 4 M12 9 V21',
  exit: 'M14 4 H20 V20 H14 M10 8 L6 12 L10 16 M6 12 H16',
  wheelchair: 'M10.5 3.5 a1.6 1.6 0 1 0 0.01 0 Z M10.5 7 V13 H15.5 L18 18.5 M10.5 10 H15 M8 10.5 a5.2 5.2 0 1 0 7.2 7.4',
  bolt: 'M13 2 L5 13 H11 L10 22 L19 10 H13 Z',
  shield: 'M12 3 L20 6 V12 C20 16.5 16.5 19.8 12 21 C7.5 19.8 4 16.5 4 12 V6 Z M8.5 12 L11 14.5 L15.5 9.5',
  roof: 'M3 11 L12 4 L21 11 M5 10 V20 H19 V10',
  wow: 'M12 3 L13.6 9.2 L20 9.5 L15 13.4 L16.8 20 L12 16.2 L7.2 20 L9 13.4 L4 9.5 L10.4 9.2 Z',
};

export default function Icon({ name, size = '1.15em', className = '', title }) {
  const id = useId();
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={`url(#g${id})`}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3c2" />
          <stop offset=".45" stopColor="#f2c230" />
          <stop offset="1" stopColor="#b8860b" />
        </linearGradient>
      </defs>
      <path d={PATHS[name]} />
    </svg>
  );
}
