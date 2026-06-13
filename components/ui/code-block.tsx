import { cn } from "@/lib/utils"
import React, { useEffect, useState } from "react"
import { codeToTokens, type BundledLanguage, type SpecialLanguage } from "shiki"

type HighlightToken = {
  content: string
  color?: string
  bgColor?: string
  fontStyle?: number
}

type HighlightLine = HighlightToken[]

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "border-border bg-card text-card-foreground rounded-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-light",
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedLines, setHighlightedLines] = useState<HighlightLine[] | null>(null)

  useEffect(() => {
    let active = true
    async function highlight() {
      if (!code) {
        if (active) setHighlightedLines([])
        return
      }

      try {
        const result = await codeToTokens(code, { lang: language as BundledLanguage | SpecialLanguage, theme })
        if (active) setHighlightedLines(result.tokens as HighlightLine[])
      } catch {
        if (active) setHighlightedLines(null)
      }
    }
    highlight()

    return () => {
      active = false
    }
  }, [code, language, theme])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )

  return (
    <div className={classNames} {...props}>
      <pre>
        <code>
          {highlightedLines ? renderTokenLines(highlightedLines) : code}
        </code>
      </pre>
    </div>
  )
}

function renderTokenLines(lines: HighlightLine[]): React.ReactNode {
  return lines.map((line, lineIndex) => (
    <React.Fragment key={lineIndex}>
      {line.map((token, tokenIndex) => (
        <span key={`${lineIndex}-${tokenIndex}`} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
      {lineIndex < lines.length - 1 ? "\n" : null}
    </React.Fragment>
  ))
}

function tokenStyle(token: HighlightToken): React.CSSProperties {
  return {
    color: token.color,
    backgroundColor: token.bgColor,
    fontStyle: token.fontStyle && (token.fontStyle & 1) ? "italic" : undefined,
    fontWeight: token.fontStyle && (token.fontStyle & 2) ? 700 : undefined,
    textDecorationLine: token.fontStyle && (token.fontStyle & 4) ? "underline" : undefined,
  }
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
