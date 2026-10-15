// Iconos de trazo (1.75 px), dibujados a mano para no cargar una librería entera.
import type { SVGProps } from "react";

const base = (d: React.ReactNode) =>
  function Icon(p: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...p}
      >
        {d}
      </svg>
    );
  };

export const IconChevronLeft = base(<path d="m15 18-6-6 6-6" />);
export const IconChevronRight = base(<path d="m9 18 6-6-6-6" />);
export const IconArrowLeft = base(<path d="M19 12H5m6 6-6-6 6-6" />);
export const IconRefresh = base(
  <>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
  </>,
);
export const IconSun = base(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const IconMoon = base(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />);
export const IconInfo = base(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4.5M12 8h.01" />
  </>,
);
export const IconSearch = base(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const IconX = base(<path d="M18 6 6 18M6 6l12 12" />);
export const IconMenu = base(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconUsers = base(
  <>
    <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
    <circle cx="10" cy="8" r="3.5" />
    <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.65a3.5 3.5 0 0 1 0 6.7" />
  </>,
);
export const IconCalendar = base(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18M8 2.5v4m8-4v4" />
  </>,
);
export const IconLogout = base(<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />);
export const IconPlay = base(<path d="M7 4.5v15l12.5-7.5L7 4.5Z" />);
export const IconPhoneOut = base(
  <>
    <path d="M15 3h6v6M21 3l-7 7" />
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </>,
);
export const IconPhoneIn = base(
  <>
    <path d="M20 4l-6 6M14 4v6h6" />
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </>,
);
export const IconPhoneMissed = base(
  <>
    <path d="m15 3 6 6m0-6-6 6" />
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </>,
);
export const IconUp = base(<path d="M12 19V5m-6 6 6-6 6 6" />);
export const IconDown = base(<path d="M12 5v14m6-6-6 6-6-6" />);
export const IconSort = base(<path d="m7 15 5 5 5-5M7 9l5-5 5 5" />);
export const IconAlert = base(
  <>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4m0 3h.01" />
  </>,
);
