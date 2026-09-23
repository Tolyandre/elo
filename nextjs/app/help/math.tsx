import katex from "katex"
import "katex/dist/katex.min.css"

// Firefox has strict MathML validation; KaTeX's default "htmlAndMathml" output
// produces invalid <msub> markup for constructs like \underbrace{x}_{y}.
// Forcing HTML-only output avoids the issue across all browsers.
export function BlockMath({ math }: { math: string }) {
    const html = katex.renderToString(math, { displayMode: true, output: "html", throwOnError: false })
    return <div dangerouslySetInnerHTML={{ __html: html }} />
}
export function InlineMath({ math }: { math: string }) {
    const html = katex.renderToString(math, { displayMode: false, output: "html", throwOnError: false })
    return <span dangerouslySetInnerHTML={{ __html: html }} />
}
