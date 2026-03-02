"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  memo,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import {
  Eye,
  Code2,
  Columns2,
  Copy,
  Check,
  Printer,
  Download,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import mermaid from "mermaid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "preview" | "raw" | "split";

type ReportViewerProps = {
  markdown: string;
  isDark: boolean;
  onCopy?: () => void;
  onDownload?: () => void;
  onClear?: () => void;
  copied?: boolean;
  headerSlot?: React.ReactNode;
};

// ---------------------------------------------------------------------------
// Sanitize schema: allow KaTeX classes/attrs and mermaid containers
// ---------------------------------------------------------------------------

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", /^(math|katex|mermaid)/],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", /^(katex|mord|mbin|mrel|mopen|mclose|mpunct|minner|mop|mfrac|msqrt|mspace|msupsub|vlist|strut|base|overline|underline|accent|nulldelimiter|delimsizing|sizing|reset-size|fontsize|text|mathnormal|mathit|mathbf|mathbb|mathcal|mathfrak|mathscr|mathsf|mathtt|boldsymbol)/],
      "style",
      "aria-hidden",
    ],
    math: [["xmlns"]],
    semantics: [],
    annotation: [["encoding"]],
    svg: [
      ["xmlns"],
      "viewBox",
      "width",
      "height",
      "style",
      "role",
      "aria-roledescription",
      ["className"],
    ],
    g: [["transform"], ["className"]],
    path: [["d"], ["fill"], ["stroke"], ["strokeWidth"], ["className"]],
    rect: [
      ["x"],
      ["y"],
      ["width"],
      ["height"],
      ["rx"],
      ["ry"],
      ["fill"],
      ["stroke"],
      ["className"],
    ],
    circle: [["cx"], ["cy"], ["r"], ["fill"], ["stroke"], ["className"]],
    line: [
      ["x1"],
      ["y1"],
      ["x2"],
      ["y2"],
      ["stroke"],
      ["strokeWidth"],
      ["className"],
    ],
    text: [
      ["x"],
      ["y"],
      ["textAnchor"],
      ["dominantBaseline"],
      ["fill"],
      ["fontSize"],
      ["className"],
    ],
    polygon: [["points"], ["fill"], ["stroke"], ["className"]],
    polyline: [["points"], ["fill"], ["stroke"], ["className"]],
    marker: [
      ["id"],
      ["viewBox"],
      ["refX"],
      ["refY"],
      ["markerWidth"],
      ["markerHeight"],
      ["orient"],
    ],
    defs: [],
    clipPath: [["id"]],
    use: [["href"], ["xlinkHref"]],
    foreignObject: [["x"], ["y"], ["width"], ["height"]],
    style: [],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "mfrac",
    "msqrt",
    "mroot",
    "mover",
    "munder",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mtext",
    "mspace",
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "line",
    "text",
    "polygon",
    "polyline",
    "marker",
    "defs",
    "clipPath",
    "use",
    "foreignObject",
    "style",
  ],
};

// ---------------------------------------------------------------------------
// Mermaid initialisation (once)
// ---------------------------------------------------------------------------

let mermaidInitialized = false;

function ensureMermaidInit(isDark: boolean) {
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      securityLevel: "strict",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    });
    mermaidInitialized = true;
  }
}

// ---------------------------------------------------------------------------
// Mermaid block renderer
// ---------------------------------------------------------------------------

let mermaidCounter = 0;

const MermaidBlock = memo(function MermaidBlock({
  code,
  isDark,
}: {
  code: string;
  isDark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Date.now()}-${++mermaidCounter}`);

  useEffect(() => {
    let cancelled = false;
    ensureMermaidInit(isDark);

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(
          idRef.current,
          code.trim()
        );
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to render diagram"
          );
          setSvg("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, isDark]);

  if (error) {
    return (
      <div
        className={`my-4 rounded-lg border p-4 text-sm ${isDark ? "border-amber-500/30 bg-amber-500/5 text-amber-300" : "border-amber-300 bg-amber-50 text-amber-700"}`}
      >
        <p className="mb-2 font-medium">Diagram could not be rendered</p>
        <pre className="overflow-x-auto text-xs opacity-70">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram my-6 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});

// ---------------------------------------------------------------------------
// Preprocess markdown: sanitise <br> tags, protect math blocks
// ---------------------------------------------------------------------------

function preprocessMarkdown(md: string): string {
  let result = md.replace(/<br\s*\/?>/gi, "\n");
  result = result.replace(/<script[\s>][\s\S]*?<\/script>/gi, "");
  result = result.replace(/<style[\s>][\s\S]*?<\/style>/gi, "");
  return result;
}

// ---------------------------------------------------------------------------
// View mode toggle
// ---------------------------------------------------------------------------

const VIEW_MODES: { id: ViewMode; label: string; icon: typeof Eye }[] = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "raw", label: "Raw", icon: Code2 },
  { id: "split", label: "Split", icon: Columns2 },
];

// ---------------------------------------------------------------------------
// Rendered markdown (memoised)
// ---------------------------------------------------------------------------

const RenderedMarkdown = memo(function RenderedMarkdown({
  markdown,
  isDark,
}: {
  markdown: string;
  isDark: boolean;
}) {
  const processed = useMemo(() => preprocessMarkdown(markdown), [markdown]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeSanitize, sanitizeSchema],
        rehypeKatex,
        rehypeSlug,
        [rehypeAutolinkHeadings, { behavior: "wrap" }],
      ]}
      components={{
        a: ({ href, children }) => {
          const safeHref =
            href &&
            (href.startsWith("http://") ||
              href.startsWith("https://") ||
              href.startsWith("#"))
              ? href
              : "#";
          return (
            <a
              href={safeHref}
              target={safeHref.startsWith("#") ? undefined : "_blank"}
              rel={
                safeHref.startsWith("#") ? undefined : "noopener noreferrer"
              }
              className="text-emerald-400 underline hover:text-emerald-300"
            >
              {children}
            </a>
          );
        },
        h1: ({ children, id }) => (
          <h1 id={id} className="mt-10 mb-4 text-2xl font-bold">
            {children}
          </h1>
        ),
        h2: ({ children, id }) => (
          <h2 id={id} className="mt-8 mb-4 text-xl font-bold">
            {children}
          </h2>
        ),
        h3: ({ children, id }) => (
          <h3
            id={id}
            className="mt-6 mb-3 text-lg font-semibold text-slate-700 dark:text-slate-200"
          >
            {children}
          </h3>
        ),
        h4: ({ children, id }) => (
          <h4
            id={id}
            className="mt-4 mb-2 text-base font-semibold text-slate-600 dark:text-slate-300"
          >
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p
            className={`mb-4 leading-relaxed ${isDark ? "text-slate-300" : "text-slate-700"}`}
          >
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul
            className={`mb-4 list-disc space-y-1 pl-6 ${isDark ? "text-slate-300" : "text-slate-700"}`}
          >
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol
            className={`mb-4 list-decimal space-y-1 pl-6 ${isDark ? "text-slate-300" : "text-slate-700"}`}
          >
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        table: ({ children }) => (
          <div className="my-4 overflow-x-auto rounded-lg border border-slate-600/30">
            <table className="min-w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead
            className={
              isDark ? "bg-slate-700/50 text-slate-200" : "bg-slate-100 text-slate-800"
            }
          >
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th className="px-4 py-2 text-left font-semibold">{children}</th>
        ),
        td: ({ children }) => (
          <td
            className={`border-t px-4 py-2 ${isDark ? "border-slate-600/30" : "border-slate-200"}`}
          >
            {children}
          </td>
        ),
        blockquote: ({ children }) => (
          <blockquote
            className={`border-l-4 border-emerald-500/50 pl-4 italic ${isDark ? "text-slate-400" : "text-slate-500"}`}
          >
            {children}
          </blockquote>
        ),
        hr: () => (
          <hr
            className={`my-6 ${isDark ? "border-slate-700" : "border-slate-200"}`}
          />
        ),
        img: ({ src, alt }) => (
          <figure className="my-6">
            <img
              src={src}
              alt={alt || ""}
              className="mx-auto max-w-full rounded-lg shadow-md"
              loading="lazy"
            />
            {alt && (
              <figcaption
                className={`mt-2 text-center text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}
              >
                {alt}
              </figcaption>
            )}
          </figure>
        ),
        code: ({ children, className }) => {
          const match = /language-(\w+)/.exec(className || "");
          const lang = match?.[1];
          const codeStr = String(children).replace(/\n$/, "");

          if (lang === "mermaid") {
            return <MermaidBlock code={codeStr} isDark={isDark} />;
          }

          if (className) {
            return (
              <div className="group relative my-4">
                {lang && (
                  <div
                    className={`absolute right-3 top-2 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isDark ? "bg-slate-600/60 text-slate-400" : "bg-slate-200 text-slate-500"}`}
                  >
                    {lang}
                  </div>
                )}
                <pre
                  className={`overflow-x-auto rounded-lg p-4 text-sm leading-relaxed ${isDark ? "bg-slate-900/80 text-slate-200" : "bg-slate-50 text-slate-800"}`}
                >
                  <code>{codeStr}</code>
                </pre>
              </div>
            );
          }

          return (
            <code
              className={`rounded px-1.5 py-0.5 font-mono text-sm ${isDark ? "bg-slate-700/60" : "bg-slate-200/80"}`}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {processed}
    </ReactMarkdown>
  );
});

// ---------------------------------------------------------------------------
// ReportViewer component
// ---------------------------------------------------------------------------

export default function ReportViewer({
  markdown,
  isDark,
  onCopy,
  onDownload,
  onClear,
  copied = false,
  headerSlot,
}: ReportViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [internalCopied, setInternalCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (onCopy) {
      onCopy();
      return;
    }
    await navigator.clipboard.writeText(markdown);
    setInternalCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setInternalCopied(false), 2000);
  }, [markdown, onCopy]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const isCopied = onCopy ? copied : internalCopied;

  const bg = isDark
    ? "border-slate-700/60 bg-slate-800/30 shadow-slate-900/50"
    : "border-slate-200 bg-white/90 shadow-slate-200/50";
  const toolbarBg = isDark
    ? "border-slate-700/60"
    : "border-slate-200";
  const btnBase = isDark
    ? "bg-slate-700/60 text-slate-300 hover:bg-slate-600/60"
    : "bg-slate-100 text-slate-600 hover:bg-slate-200";

  return (
    <div className={`report-viewer rounded-2xl border shadow-xl ${bg}`}>
      {/* Header */}
      <div
        className={`report-viewer-toolbar flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4 ${toolbarBg}`}
      >
        <div className="flex items-center gap-3">
          {headerSlot}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div
            className={`flex rounded-lg p-0.5 ${isDark ? "bg-slate-700/40" : "bg-slate-100"}`}
          >
            {VIEW_MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setViewMode(id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  viewMode === id
                    ? isDark
                      ? "bg-slate-600 text-white shadow-sm"
                      : "bg-white text-slate-900 shadow-sm"
                    : isDark
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-slate-500 hover:text-slate-700"
                }`}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <div
            className={`mx-1 h-6 w-px ${isDark ? "bg-slate-700" : "bg-slate-200"}`}
          />

          {/* Actions */}
          <button
            onClick={handleCopy}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${btnBase}`}
          >
            {isCopied ? (
              <>
                <Check className="h-4 w-4 text-emerald-500" /> Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy
              </>
            )}
          </button>

          {viewMode === "preview" && (
            <button
              onClick={handlePrint}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${btnBase}`}
              title="Print report"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
          )}

          {onDownload && (
            <button
              onClick={onDownload}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${btnBase}`}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Download .md</span>
            </button>
          )}

          {onClear && (
            <button
              onClick={onClear}
              className="flex items-center gap-2 rounded-lg bg-rose-600/20 px-4 py-2 text-sm font-medium text-rose-400 transition hover:bg-rose-600/30"
              title="Clear this report"
            >
              <Trash2 className="h-4 w-4" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === "preview" && (
        <article
          className={`prose max-w-none px-6 py-8 ${isDark ? "prose-invert prose-slate" : "prose-slate"}`}
        >
          <RenderedMarkdown markdown={markdown} isDark={isDark} />
        </article>
      )}

      {viewMode === "raw" && (
        <div className="report-viewer-raw-pane px-6 py-6">
          <pre
            className={`overflow-x-auto whitespace-pre-wrap rounded-xl p-6 font-mono text-sm leading-relaxed ${isDark ? "bg-slate-900/60 text-slate-300" : "bg-slate-50 text-slate-700"}`}
          >
            {markdown}
          </pre>
        </div>
      )}

      {viewMode === "split" && (
        <div className="report-viewer-raw-pane flex flex-col lg:flex-row">
          <div
            className={`flex-1 overflow-auto border-b p-6 lg:border-b-0 lg:border-r ${isDark ? "border-slate-700/60" : "border-slate-200"}`}
          >
            <article
              className={`prose max-w-none ${isDark ? "prose-invert prose-slate" : "prose-slate"}`}
            >
              <RenderedMarkdown markdown={markdown} isDark={isDark} />
            </article>
          </div>
          <div className="flex-1 overflow-auto p-6">
            <pre
              className={`overflow-x-auto whitespace-pre-wrap rounded-xl p-4 font-mono text-sm leading-relaxed ${isDark ? "bg-slate-900/60 text-slate-300" : "bg-slate-50 text-slate-700"}`}
            >
              {markdown}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
