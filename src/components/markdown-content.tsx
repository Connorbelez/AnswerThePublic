import type { ComponentProps } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

type MarkdownContentProps = {
  children: string
  className?: string
  minimumHeadingLevel?: 1 | 2 | 3 | 4 | 5 | 6
}

type HeadingLevel = NonNullable<MarkdownContentProps["minimumHeadingLevel"]>

function headingRenderer(
  sourceLevel: HeadingLevel,
  minimumHeadingLevel: HeadingLevel
) {
  const Heading = `h${Math.max(sourceLevel, minimumHeadingLevel)}` as
    "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  return ({ node, ...props }: ComponentProps<"h1"> & { node?: unknown }) => {
    void node
    return <Heading {...props} />
  }
}

export function MarkdownContent({
  children,
  className,
  minimumHeadingLevel = 1,
}: MarkdownContentProps) {
  return (
    <div className={cn("typeset typeset-request", className)} data-typeset="">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: headingRenderer(1, minimumHeadingLevel),
          h2: headingRenderer(2, minimumHeadingLevel),
          h3: headingRenderer(3, minimumHeadingLevel),
          h4: headingRenderer(4, minimumHeadingLevel),
          h5: headingRenderer(5, minimumHeadingLevel),
          h6: headingRenderer(6, minimumHeadingLevel),
          a: ({ children: linkChildren, node, ...props }) => {
            void node
            return (
              <a
                {...(props as ComponentProps<"a">)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {linkChildren}
              </a>
            )
          },
          table: ({ children: tableChildren, node, ...props }) => {
            void node
            return (
              <div
                className="typeset-scroll"
                role="region"
                aria-label="Scrollable table"
                tabIndex={0}
              >
                <table {...props}>{tableChildren}</table>
              </div>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
