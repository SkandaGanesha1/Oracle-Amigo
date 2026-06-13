import { CheckIcon, CopyIcon } from "lucide-react"
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type HTMLAttributes,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { type BundledLanguage, codeToTokens } from "shiki"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"

type HighlightToken = {
  content: string
  color?: string
  bgColor?: string
  fontStyle?: number
}

type HighlightLine = HighlightToken[]

type HighlightResult = {
  light: HighlightLine[]
  dark: HighlightLine[]
}

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}

interface CodeBlockContextType {
  code: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
})

export async function highlightCode(
  code: string,
  language: BundledLanguage,
): Promise<HighlightResult> {
  const [light, dark] = await Promise.all([
    codeToTokens(code, {
      lang: language,
      theme: "one-light",
    }),
    codeToTokens(code, {
      lang: language,
      theme: "one-dark-pro",
    }),
  ])

  return {
    light: light.tokens as HighlightLine[],
    dark: dark.tokens as HighlightLine[],
  }
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [highlighted, setHighlighted] = useState<HighlightResult | null>(null)
  const highlightRequest = useRef(0)

  useEffect(() => {
    const requestId = highlightRequest.current + 1
    highlightRequest.current = requestId

    highlightCode(code, language)
      .then((nextHighlighted) => {
        if (highlightRequest.current !== requestId) return
        setHighlighted(nextHighlighted)
      })
      .catch(() => {
        if (highlightRequest.current !== requestId) return
        setHighlighted(null)
      })

    return () => {
      if (highlightRequest.current === requestId) highlightRequest.current += 1
    }
  }, [code, language, showLineNumbers])

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
          className,
        )}
        {...props}
      >
        <div className="relative">
          <div
            className="overflow-auto dark:hidden [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
          >
            <pre>
              <code>{highlighted ? renderTokenLines(highlighted.light, showLineNumbers) : code}</code>
            </pre>
          </div>
          <div
            className="hidden overflow-auto dark:block [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
          >
            <pre>
              <code>{highlighted ? renderTokenLines(highlighted.dark, showLineNumbers) : code}</code>
            </pre>
          </div>
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">{children}</div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

function renderTokenLines(lines: HighlightLine[], showLineNumbers: boolean): ReactNode {
  return lines.map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {showLineNumbers && (
        <span className="inline-block min-w-10 mr-4 select-none text-right text-muted-foreground">
          {lineIndex + 1}
        </span>
      )}
      {line.map((token, tokenIndex) => (
        <span key={`${lineIndex}-${tokenIndex}`} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
      {lineIndex < lines.length - 1 ? "\n" : null}
    </Fragment>
  ))
}

function tokenStyle(token: HighlightToken): CSSProperties {
  return {
    color: token.color,
    backgroundColor: token.bgColor,
    fontStyle: token.fontStyle && (token.fontStyle & 1) ? "italic" : undefined,
    fontWeight: token.fontStyle && (token.fontStyle & 2) ? 700 : undefined,
    textDecorationLine: token.fontStyle && (token.fontStyle & 4) ? "underline" : undefined,
  }
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"))
      return
    }

    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      onCopy?.()
      setTimeout(() => setIsCopied(false), timeout)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  )
}

/** Demo component for preview */
export default function CodeBlockDemo() {
  const code = `function MyComponent(props) {
  return (
    <div>
      <h1>Hello, {props.name}!</h1>
      <p>This is an example React component.</p>
    </div>
  );
}`

  return (
    <div className="w-full max-w-2xl p-6">
      <CodeBlock code={code} language="jsx">
        <CodeBlockCopyButton
          onCopy={() => console.log("Copied code to clipboard")}
          onError={() => console.error("Failed to copy code to clipboard")}
        />
      </CodeBlock>
    </div>
  )
}
