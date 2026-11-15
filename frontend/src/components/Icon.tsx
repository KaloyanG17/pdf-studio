/** Hairline icons: 20×20, 1.25px strokes in currentColor. */
const P: Record<string, React.ReactNode> = {
  select: <path d="M5 3.5l10 6.2-4.6 1.1 2.6 4.9-1.7.9-2.6-4.9L5.5 15z" />,
  edittext: (
    <>
      <path d="M3.5 5V3.5h9V5M8 3.5v12M6 15.5h4" />
      <path d="M15 9v8M13.5 9h3M13.5 17h3" />
    </>
  ),
  text: <path d="M4 5.5V4h12v1.5M10 4v12.5M7.5 16.5h5" />,
  draw: <path d="M3 14.5c2.5-6 4.5-8 6-6.5s-1.5 5 .5 6 4-3 7.5-6" />,
  highlight: (
    <>
      <path d="M12.5 3.5l4 4-6.5 6.5h-4v-4z" />
      <path d="M3 17h14" />
    </>
  ),
  whiteout: (
    <>
      <rect x="3.5" y="5.5" width="13" height="9" rx="1" />
      <path d="M6 12.5l8-5" />
    </>
  ),
  rect: <rect x="3.5" y="4.5" width="13" height="11" rx="0.5" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5.5" />,
  line: <path d="M4 16L16 4" />,
  arrow: <path d="M4 16L16 4M9.5 4H16v6.5" />,
  eraser: (
    <>
      <path d="M8 16.5h8.5M3.8 11.7l7-7a1.4 1.4 0 012 0l2.5 2.5a1.4 1.4 0 010 2l-6.3 6.3H6.6l-2.8-2.8a.7.7 0 010-1z" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1" />
      <circle cx="7.5" cy="8" r="1.3" />
      <path d="M3.5 14l4-3.5 3 2.5 2.5-2 3.5 3" />
    </>
  ),
  sign: <path d="M3 13.5c1.5-4 3-6.5 4-6s-1 6 0 6.5 2-4 3-4 0 3 1 3 1.5-1.5 2.5-1.5M3 16.5h14" />,
  undo: <path d="M7 6.5L4 9.5l3 3M4.5 9.5h7a4 4 0 010 8H9" />,
  redo: <path d="M13 6.5l3 3-3 3M15.5 9.5h-7a4 4 0 000 8H11" />,
  minus: <path d="M5 10h10" />,
  plus: <path d="M5 10h10M10 5v10" />,
  translate: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3c-2.5 2.5-2.5 11.5 0 14M10 3c2.5 2.5 2.5 11.5 0 14" />
    </>
  ),
  download: <path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4 16.5h12" />,
  search: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2L16.5 16.5" />
    </>
  ),
  hash: <path d="M7.5 3.5l-1.5 13M14 3.5l-1.5 13M4 7.5h12.5M3.5 12.5H16" />,
  eye: (
    <>
      <path d="M2.5 10s3-5.5 7.5-5.5 7.5 5.5 7.5 5.5-3 5.5-7.5 5.5S2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2.2" />
    </>
  ),
  keys: (
    <>
      <rect x="2.5" y="5.5" width="15" height="9" rx="1" />
      <path d="M5.5 8.5h1M9.5 8.5h1M13.5 8.5h1M6.5 11.5h7" />
    </>
  ),
  rotl: <path d="M6 4.5L3.5 7 6 9.5M3.5 7H11a5 5 0 110 10H8" />,
  rotr: <path d="M14 4.5L16.5 7 14 9.5M16.5 7H9a5 5 0 100 10h3" />,
  copy: (
    <>
      <rect x="6.5" y="6.5" width="10" height="10" rx="1" />
      <path d="M13.5 6.5V4.5a1 1 0 00-1-1h-8a1 1 0 00-1 1v8a1 1 0 001 1h2" />
    </>
  ),
  trash: <path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6" />,
  up: <path d="M10 16V4M5.5 8.5L10 4l4.5 4.5" />,
  down: <path d="M10 4v12M5.5 11.5L10 16l4.5-4.5" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  home: <path d="M3.5 9.5L10 4l6.5 5.5M5.5 8v8h9V8M8.5 16v-4.5h3V16" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2" />
    </>
  ),
  columns: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1" />
      <path d="M10 4v12" />
    </>
  ),
  restore: <path d="M4 10a6 6 0 106-6 6.2 6.2 0 00-4.5 2M4 3.5V7h3.5" />,
  book: <path d="M4 4.5A1.5 1.5 0 015.5 3H16v12H5.5A1.5 1.5 0 004 16.5zM4 16.5A1.5 1.5 0 005.5 18H16v-3" />,
  swap: <path d="M4 7h12M13 4l3 3-3 3M16 13H4M7 10l-3 3 3 3" />,
  sun: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3" />
    </>
  ),
  moon: <path d="M15.5 12.3A6.5 6.5 0 017.7 4.5a6.5 6.5 0 107.8 7.8z" />,
  open: <path d="M3.5 16.5V5.5h4.5l1.5 1.5h7v9.5zM3.5 9h13" />,
  merge: <path d="M5 3.5v4a3 3 0 003 3h4a3 3 0 013 3v3M15 3.5v4a3 3 0 01-3 3M12.5 14l2.5 2.5 2.5-2.5" />,
  page: <path d="M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5" />,
  bold: <path d="M6 4h5a3 3 0 010 6H6zM6 10h5.5a3.2 3.2 0 010 6.4H6z" />,
  italic: <path d="M9 4h6M5 16h6M12 4L8 16" />,
  underline: <path d="M6 3.5v6a4 4 0 008 0v-6M4.5 17h11" />,
  alignl: <path d="M3.5 5h13M3.5 8.5h8M3.5 12h13M3.5 15.5h8" />,
  alignc: <path d="M3.5 5h13M6 8.5h8M3.5 12h13M6 15.5h8" />,
  alignr: <path d="M3.5 5h13M8.5 8.5h8M3.5 12h13M8.5 15.5h8" />,
  user: (
    <>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.8 16.5c.9-3 3.3-4.5 6.2-4.5s5.3 1.5 6.2 4.5" />
    </>
  ),
  cloud: <path d="M6 15.5h8.2a3.3 3.3 0 00.4-6.6A4.6 4.6 0 005.8 8.3 3.6 3.6 0 006 15.5z" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  more: (
    <>
      <circle cx="5" cy="10" r=".6" />
      <circle cx="10" cy="10" r=".6" />
      <circle cx="15" cy="10" r=".6" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {P[name]}
    </svg>
  );
}

/** Landing illustration: a clean invoice sheet with a glass card floating over it. */
export function DocArt() {
  return (
    <svg className="doc-art" width="200" height="132" viewBox="0 0 200 132" fill="none" aria-hidden>
      <defs>
        <linearGradient id="da-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8075ff" />
          <stop offset="0.6" stopColor="#6320ee" />
          <stop offset="1" stopColor="#fc6dab" />
        </linearGradient>
      </defs>
      <rect x="38" y="6" width="96" height="122" rx="6" fill="#fff" />
      <rect x="38.5" y="6.5" width="95" height="121" rx="5.5" stroke="#211a1d" strokeOpacity=".08" />
      <rect x="50" y="20" width="26" height="6" rx="3" fill="url(#da-accent)" />
      <rect x="98" y="20" width="24" height="3" rx="1.5" fill="#211a1d" fillOpacity=".18" />
      <rect x="106" y="26" width="16" height="3" rx="1.5" fill="#211a1d" fillOpacity=".12" />
      <rect x="50" y="42" width="72" height="1" fill="#211a1d" fillOpacity=".1" />
      {[52, 64, 76].map((y) => (
        <g key={y}>
          <rect x="50" y={y} width="40" height="3" rx="1.5" fill="#211a1d" fillOpacity=".16" />
          <rect x="108" y={y} width="14" height="3" rx="1.5" fill="#211a1d" fillOpacity=".22" />
        </g>
      ))}
      <rect x="50" y="88" width="72" height="1" fill="#211a1d" fillOpacity=".1" />
      <rect x="92" y="96" width="30" height="7" rx="3.5" fill="#211a1d" fillOpacity=".85" />
      <path d="M52 114c5-7 8-9 10-7s-3 6 0 6 5-5 8-5" stroke="#6320ee" strokeWidth="1.4" strokeLinecap="round" />
      <g>
        <rect x="112" y="58" width="78" height="44" rx="12" fill="#fff" fillOpacity=".6" />
        <rect x="112.5" y="58.5" width="77" height="43" rx="11.5" stroke="#fff" />
        <text x="124" y="76" fontFamily="system-ui, sans-serif" fontSize="9" fill="#211a1d" fillOpacity=".55">BG</text>
        <path d="M140 73h12m-3-3l3 3-3 3" stroke="#6320ee" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <text x="158" y="76" fontFamily="system-ui, sans-serif" fontSize="9" fontWeight="600" fill="#6320ee">EN</text>
        <rect x="124" y="84" width="54" height="3" rx="1.5" fill="url(#da-accent)" fillOpacity=".7" />
        <rect x="124" y="91" width="36" height="3" rx="1.5" fill="#211a1d" fillOpacity=".14" />
      </g>
      <circle cx="30" cy="38" r="5" fill="#ffffc6" stroke="#211a1d" strokeOpacity=".1" />
      <circle cx="176" cy="22" r="3.5" fill="#fc6dab" fillOpacity=".8" />
    </svg>
  );
}
