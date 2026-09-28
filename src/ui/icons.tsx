import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
})

export const HistoryIcon = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3.4 7.2A7 7 0 1 1 3 10" />
    <path d="M3 4v3.4h3.4" />
    <path d="M10 6.4V10l2.4 1.6" />
  </svg>
)

export const SearchIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13.2 13.2 3.3 3.3" />
  </svg>
)

export const CloseIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </svg>
)

export const GearIcon = ({ size = 17, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M8.6 2.9h2.8l.4 2 1.4.8 1.9-.7 1.4 2.4-1.5 1.4v1.6l1.5 1.4-1.4 2.4-1.9-.7-1.4.8-.4 2H8.6l-.4-2-1.4-.8-1.9.7-1.4-2.4L5 10.8V9.2L3.5 7.8l1.4-2.4 1.9.7 1.4-.8.4-2Z" />
    <circle cx="10" cy="10" r="2.3" />
  </svg>
)

export const SyncIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M16 10a6 6 0 0 1-10.6 3.9M4 10a6 6 0 0 1 10.6-3.9" />
    <path d="M14.8 2.8v3.4h-3.4M5.2 17.2v-3.4h3.4" />
  </svg>
)

export const ChevronIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p} className={`chev ${p.className ?? ''}`}>
    <path d="m6 8 4 4 4-4" />
  </svg>
)

export const CalendarIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="3.2" y="4.2" width="13.6" height="12.6" rx="2.2" />
    <path d="M3.2 8.2h13.6M7 2.6v3M13 2.6v3" />
  </svg>
)

export const BackIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 4.5 6.5 10l5.5 5.5" />
  </svg>
)

export const CheckIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </svg>
)

export const LockIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="4.5" y="8.8" width="11" height="8.2" rx="2" />
    <path d="M7 8.8V6.5a3 3 0 0 1 6 0v2.3" />
  </svg>
)

export const AlertIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10 3.2 17.4 16H2.6L10 3.2Z" />
    <path d="M10 8.2v3.4M10 13.9v.1" />
  </svg>
)
