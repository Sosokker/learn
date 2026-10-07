import type { ComponentProps, ReactNode } from "react"

// 16px stroke icons drawn in currentColor, so the shell stays one-accent.
type IconProps = ComponentProps<"svg">

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-3v-4H6v4H3a.5.5 0 0 1-.5-.5Z" />
  </Icon>
)
export const CompassIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="m10.3 5.7-1.4 3.2-3.2 1.4 1.4-3.2Z" />
  </Icon>
)
export const LibraryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 2.5v11M6 2.5v11M9 3l3.5 10" />
  </Icon>
)
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.06 1.06M4.66 11.34 3.6 12.4M12.4 12.4l-1.06-1.06M4.66 4.66 3.6 3.6" />
  </Icon>
)
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
)
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
)
export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Icon>
)
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
)
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.25 3.25" />
  </Icon>
)
export const HeartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 13.25S2.25 10 2.25 6.1A2.85 2.85 0 0 1 8 4.6a2.85 2.85 0 0 1 5.75 1.5C13.75 10 8 13.25 8 13.25Z" />
  </Icon>
)
export const ForkIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="11.5" cy="3.5" r="1.5" />
    <circle cx="8" cy="12.5" r="1.5" />
    <path d="M4.5 5v1.5a1.5 1.5 0 0 0 1.5 1.5h4a1.5 1.5 0 0 0 1.5-1.5V5M8 8v3" />
  </Icon>
)
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
)
export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 10.5V2.75M5 5.5l3-3 3 3M2.75 10.5v2.25h10.5V10.5" />
  </Icon>
)
export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.5.5M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.5-.5" />
  </Icon>
)
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.5a.75.75 0 0 0 .75.75h5.3a.75.75 0 0 0 .75-.75l.6-8.5" />
  </Icon>
)
export const MoreIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.1" />
    <circle cx="8" cy="8" r="1.1" />
    <circle cx="12.5" cy="8" r="1.1" />
  </Icon>
)
export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
    <path d="M10.75 5.25v-1.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.5" />
  </Icon>
)
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
)
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.5M8 11h.01" />
  </Icon>
)
export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M2.25 8h11.5M8 2.25c1.6 1.7 2.4 3.6 2.4 5.75S9.6 12.05 8 13.75C6.4 12.05 5.6 10.15 5.6 8S6.4 3.95 8 2.25Z" />
  </Icon>
)
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.25" />
    <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" />
  </Icon>
)
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" />
    <circle cx="8" cy="8" r="1.75" />
    <path d="m2.5 13.5 11-11" />
  </Icon>
)
export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.5" cy="10.5" r="2.75" />
    <path d="m7.5 8.5 5.5-5.5M11 5l1.5 1.5" />
  </Icon>
)
export const BookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 4.25C6.75 3.25 4.75 2.75 2.5 2.75v9.5c2.25 0 4.25.5 5.5 1.5 1.25-1 3.25-1.5 5.5-1.5v-9.5c-2.25 0-4.25.5-5.5 1.5Zm0 0v9.5" />
  </Icon>
)
export const GoogleIcon = (p: IconProps) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" {...p}>
    <path
      fill="currentColor"
      d="M15.68 8.18c0-.57-.05-1.11-.15-1.64H8v3.1h4.3a3.68 3.68 0 0 1-1.6 2.41v2h2.58c1.51-1.39 2.4-3.44 2.4-5.87ZM8 16c2.16 0 3.97-.72 5.29-1.94l-2.58-2a4.82 4.82 0 0 1-7.18-2.53H.86v2.07A8 8 0 0 0 8 16Zm-4.47-6.47a4.8 4.8 0 0 1 0-3.06V4.4H.86a8 8 0 0 0 0 7.2l2.67-2.07ZM8 3.18c1.22 0 2.3.42 3.16 1.24l2.3-2.3A7.7 7.7 0 0 0 8 0 8 8 0 0 0 .86 4.4l2.67 2.07A4.77 4.77 0 0 1 8 3.18Z"
    />
  </svg>
)

// Lesson kinds. Shapes, not colors: role colors belong to lesson content only.
export const SolveIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="m5.75 8.25 1.5 1.5 3-3.25" />
  </Icon>
)
export const LearnIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.75 6 8 3l6.25 3L8 9 1.75 6Z" />
    <path d="M4.5 7.4v3.1c1 .9 2.2 1.25 3.5 1.25s2.5-.35 3.5-1.25V7.4" />
  </Icon>
)
export const SituationIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 13.25h11M4 13.25V8.5M8 13.25V4.5M12 13.25v-6" />
  </Icon>
)
export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </Icon>
)
export const ProofIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.5" />
    <path d="M5.25 6h5.5M5.25 8.5h5.5M5.25 11h3" />
  </Icon>
)
export const GuideIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 7.25v4M8 5h.01" />
  </Icon>
)
