/** Line icons on a 16px grid, coloured by `currentColor`. */
import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconUpload = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
  </Icon>
);
export const IconCheck = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </Icon>
);
export const IconClose = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
export const IconArrowRight = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Icon>
);
export const IconArrowLeft = () => (
  <Icon>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </Icon>
);
export const IconArrowUpRight = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 11l6-6M6 5h5v5" />
  </Icon>
);
export const IconChevron = ({ open }: { open: boolean }) => (
  <Icon size={12}>
    <path d={open ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
  </Icon>
);
export const IconDownload = () => (
  <Icon>
    <path d="M8 2.5v8M5 7.5l3 3 3-3M2.5 13.5h11" />
  </Icon>
);
export const IconTrash = () => (
  <Icon>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 9h6.6l.7-9" />
  </Icon>
);
export const IconWarning = () => (
  <Icon size={14}>
    <path d="M8 2L1.5 13.5h13L8 2zM8 6.5v3M8 11.6v.1" />
  </Icon>
);
export const IconEye = ({ off }: { off?: boolean }) => (
  <Icon size={15}>
    {off ? (
      <path d="M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.3 4.4C2.9 5.4 1.9 6.8 1.5 8c.9 2.6 3.5 4.5 6.5 4.5 1.2 0 2.3-.3 3.3-.8M7 3.6c.3 0 .7-.1 1-.1 3 0 5.6 1.9 6.5 4.5-.3.9-.8 1.7-1.4 2.4" />
    ) : (
      <>
        <path d="M1.5 8C2.4 5.4 5 3.5 8 3.5s5.6 1.9 6.5 4.5c-.9 2.6-3.5 4.5-6.5 4.5S2.4 10.6 1.5 8z" />
        <circle cx="8" cy="8" r="2" />
      </>
    )}
  </Icon>
);
export const IconOpacity = () => (
  <Icon size={13}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 2v12a6 6 0 0 0 0-12z" fill="currentColor" stroke="none" />
  </Icon>
);
export const IconGrid = () => (
  <Icon>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Icon>
);
export const IconFocus = () => (
  <Icon>
    <rect x="2" y="2" width="8" height="12" rx="1" />
    <rect x="12" y="2" width="2" height="3.3" rx=".5" />
    <rect x="12" y="6.35" width="2" height="3.3" rx=".5" />
    <rect x="12" y="10.7" width="2" height="3.3" rx=".5" />
  </Icon>
);
export const IconSidebar = () => (
  <Icon>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M10 2.5v11" />
  </Icon>
);
export const IconSwap = () => (
  <Icon size={13}>
    <path d="M3 5.5h9M9.5 3L12 5.5 9.5 8M13 10.5H4M6.5 8L4 10.5 6.5 13" />
  </Icon>
);
export const IconMenu = () => (
  <Icon size={18}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Icon>
);
export const IconCube = () => (
  <Icon size={20}>
    <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7L8 1.5zM2.5 4.5L8 7.5l5.5-3M8 7.5v7" />
  </Icon>
);
export const IconLayers = () => (
  <Icon size={20}>
    <path d="M8 2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3" />
  </Icon>
);
export const IconCrosshair = () => (
  <Icon size={20}>
    <circle cx="8" cy="8" r="5" />
    <path d="M8 1v3.5M8 11.5V15M1 8h3.5M11.5 8H15" />
  </Icon>
);
export const IconRuler = () => (
  <Icon size={20}>
    <path d="M1.8 11.2l9.4-9.4 3 3-9.4 9.4-3-3zM4.5 8.5l1.5 1.5M6.8 6.2l1 1M9 4l1.5 1.5" />
  </Icon>
);
export const IconShield = () => (
  <Icon>
    <path d="M8 1.8l5 2v4c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4v-4l5-2z" />
  </Icon>
);
export const IconClock = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </Icon>
);
export const IconQueue = () => (
  <Icon>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h6" />
  </Icon>
);
export const IconBan = () => (
  <Icon size={14}>
    <circle cx="8" cy="8" r="6" />
    <path d="M3.8 3.8l8.4 8.4" />
  </Icon>
);

/** The brand mark: a tumor cross-section (edema, enhancing rim, core) drawn in ink, with only the core in colour. */
export const BrandMark = ({ size = 22 }: { size?: number }) => (
  <svg className="brand-mark" viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
    <circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
    <circle cx="10" cy="10" r="2.2" fill="#D9462F" />
  </svg>
);
export const IconUser = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="8" cy="5.5" r="2.75" />
    <path d="M2.75 13.5c.6-2.6 2.7-4.25 5.25-4.25s4.65 1.65 5.25 4.25" />
  </Icon>
);
export const IconUsers = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="6" cy="5.75" r="2.4" />
    <path d="M1.75 13.25c.5-2.2 2.2-3.6 4.25-3.6s3.75 1.4 4.25 3.6M10.5 3.6a2.4 2.4 0 0 1 0 4.4M11.75 9.9c1.25.5 2.15 1.7 2.5 3.35" />
  </Icon>
);
export const IconSignOut = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 11l3-3-3-3M13.5 8H6" />
  </Icon>
);
export const IconCopy = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Icon>
);
export const IconKey = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M7.6 8.4L13.5 2.5M11.5 4.5l1.75 1.75M9.75 6.25l1.25 1.25" />
  </Icon>
);
export const IconLock = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" />
  </Icon>
);
export const IconFolder = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M2 4.5a1 1 0 0 1 1-1h3.3l1.4 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z" />
  </Icon>
);
export const IconReport = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 1.75h5.5L12.5 4.75V13.5a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75V2.5a.75.75 0 0 1 .75-.75z" />
    <path d="M9.25 1.75v3.25h3.25M5.75 8h4.5M5.75 10.5h4.5" />
  </Icon>
);
