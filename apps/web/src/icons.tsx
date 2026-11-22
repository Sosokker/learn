// App icons: inline SVG on currentColor, 16px, decorative (the label is next to them).
import type { ReactNode } from "react"

function Icon(props: { readonly children: ReactNode; readonly className?: string | undefined }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={props.className}
    >
      {props.children}
    </svg>
  )
}

export const HomeIcon = () => (
  <Icon>
    <path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z" />
  </Icon>
)

export const FlagIcon = () => (
  <Icon>
    <path d="M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8" />
  </Icon>
)

export const LibraryIcon = () => (
  <Icon>
    <path d="M3 2.5v11M6 2.5v11M9 3l3.5 10" />
  </Icon>
)

export const CompassIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.75" />
    <path d="m10.5 5.5-1.5 3.5-3.5 1.5 1.5-3.5z" />
  </Icon>
)

export const FolderIcon = () => (
  <Icon>
    <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
  </Icon>
)

export const MenuIcon = () => (
  <Icon>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Icon>
)

const heart = "M8 13.5S2.5 10.3 2.5 6.3A2.8 2.8 0 0 1 8 5a2.8 2.8 0 0 1 5.5 1.3c0 4-5.5 7.2-5.5 7.2z"

export const HeartIcon = (props: { readonly filled?: boolean; readonly large?: boolean }) => (
  <Icon className={props.large === true ? undefined : "size-3.5"}>
    <path d={heart} fill={props.filled === true ? "currentColor" : "none"} />
  </Icon>
)

export const BookmarkIcon = (props: { readonly filled?: boolean }) => (
  <Icon>
    <path d="M4 2.5h8v11L8 10.5l-4 3z" fill={props.filled === true ? "currentColor" : "none"} />
  </Icon>
)

export const ResumeIcon = () => (
  <Icon>
    <path d="M3 8h9M9 4.5 12.5 8 9 11.5" />
  </Icon>
)

export const SettingsIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </Icon>
)

export const CommentIcon = () => (
  <Icon>
    <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />
  </Icon>
)

export const ShieldIcon = () => (
  <Icon>
    <path d="M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4z" />
  </Icon>
)

export const SparkIcon = () => (
  <Icon>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l1.6 1.6M10.2 10.2l1.6 1.6M4.2 11.8l1.6-1.6M10.2 5.8l1.6-1.6" />
  </Icon>
)

export const CheckCircleIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.75" />
    <path d="m5.5 8.2 1.7 1.7 3.3-3.6" />
  </Icon>
)

export const AlertIcon = () => (
  <Icon>
    <path d="M8 2.5 14 13H2z" />
    <path d="M8 6.5v3M8 11.25v.01" />
  </Icon>
)

export const PathIcon = () => (
  <Icon>
    <circle cx="3.5" cy="12.5" r="1.75" />
    <circle cx="8" cy="8" r="1.75" />
    <circle cx="12.5" cy="3.5" r="1.75" />
    <path d="M4.8 11.2 6.7 9.3M9.3 6.7 11.2 4.8" />
  </Icon>
)
