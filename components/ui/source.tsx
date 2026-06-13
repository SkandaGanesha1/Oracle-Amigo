"use client"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import { safeExternalHref, safeFaviconDomainUrl } from "@/lib/safeUrl"
import { createContext, useContext } from "react"

const SourceContext = createContext<{
  href?: string
  domain: string
} | null>(null)

function useSourceContext() {
  const ctx = useContext(SourceContext)
  if (!ctx) throw new Error("Source.* must be used inside <Source>")
  return ctx
}

export type SourceProps = {
  href: string
  children: React.ReactNode
}

export function Source({ href, children }: SourceProps) {
  const safeHref = safeExternalHref(href)
  let domain = ""
  try {
    domain = safeHref
      ? new URL(safeHref, typeof window !== "undefined" ? window.location.origin : "http://localhost").hostname
      : ""
  } catch {
    domain = href.split("/").pop() || href
  }

  return (
    <SourceContext.Provider value={{ href: safeHref, domain }}>
      <HoverCard openDelay={150} closeDelay={0}>
        {children}
      </HoverCard>
    </SourceContext.Provider>
  )
}

export type SourceTriggerProps = {
  label?: string | number
  showFavicon?: boolean
  className?: string
}

export function SourceTrigger({
  label,
  showFavicon = false,
  className,
}: SourceTriggerProps) {
  const { href, domain } = useSourceContext()
  const labelToShow = label ?? domain.replace("www.", "")
  const content = (
    <>
      {showFavicon && (
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(
            safeFaviconDomainUrl(href)
          )}`}
          alt="favicon"
          width={14}
          height={14}
          className="size-3.5 rounded-full"
        />
      )}
      <span className="truncate tabular-nums text-center font-normal">{labelToShow}</span>
    </>
  )
  const triggerClassName = cn(
    "bg-muted text-muted-foreground hover:bg-muted-foreground/30 hover:text-primary inline-flex h-5 max-w-32 items-center gap-1 overflow-hidden rounded-full py-0 text-xs no-underline transition-colors duration-150",
    showFavicon ? "pr-2 pl-1" : "px-1",
    className
  )

  if (!href) {
    return (
      <HoverCardTrigger asChild>
        <span className={triggerClassName}>{content}</span>
      </HoverCardTrigger>
    )
  }

  return (
    <HoverCardTrigger asChild>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={triggerClassName}
      >
        {content}
      </a>
    </HoverCardTrigger>
  )
}

export type SourceContentProps = {
  title: string
  description: string
  className?: string
}

export function SourceContent({
  title,
  description,
  className,
}: SourceContentProps) {
  const { href, domain } = useSourceContext()
  const content = (
    <>
      <div className="flex items-center gap-1.5">
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(
            safeFaviconDomainUrl(href)
          )}`}
          alt="favicon"
          className="size-4 rounded-full"
          width={16}
          height={16}
        />
        <div className="text-primary truncate text-sm">
          {domain.replace("www.", "")}
        </div>
      </div>
      <div className="line-clamp-2 text-sm font-medium">{title}</div>
      <div className="text-muted-foreground line-clamp-2 text-sm">
        {description}
      </div>
    </>
  )

  return (
    <HoverCardContent className={cn("w-80 p-0 shadow-xs", className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col gap-2 p-3"
        >
          {content}
        </a>
      ) : (
        <div className="flex flex-col gap-2 p-3">{content}</div>
      )}
    </HoverCardContent>
  )
}
