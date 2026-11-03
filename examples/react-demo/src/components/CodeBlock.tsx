import { Check, Copy, FileCode2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Highlight, type PrismTheme } from "prism-react-renderer";
import { cn } from "cn";

/**
 * An empty theme. prism-react-renderer wants one, but inline styles would
 * hard-code colours and break dark mode, so we take only its token
 * classNames and do the colouring in styles.css with the page's own
 * palette.
 */
const NO_INLINE_THEME: PrismTheme = { plain: {}, styles: [] };

/**
 * Just the highlighted source, no frame. Split out so signatures and other
 * bare snippets colour the same way as a full code block; `.code-block` is
 * what the token rules in styles.css hang off.
 */
export function HighlightedCode({
  code,
  language = "tsx",
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  return (
    <Highlight code={code.trim()} language={language} theme={NO_INLINE_THEME}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={cn("code-block overflow-x-auto", className)}>
          <code>
            {tokens.map((line, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

/**
 * The editor-style frame. The chrome is the point: in a page where prose
 * already contains coloured identifiers, a block needs a border and a title
 * bar to read as "this is a file", not "this is a sentence".
 *
 * `title` is whatever goes to the left of the Copy button: a language name,
 * or the tab strip below.
 */
function Frame({
  title,
  code,
  language,
  className,
  testId,
}: {
  title: ReactNode;
  code: string;
  language: string;
  className?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      data-testid={testId}
      className={cn("code-frame overflow-hidden rounded-xl border shadow-sm", className)}
    >
      <div className="code-chrome flex items-center gap-2 border-b py-1.5 pr-1.5 pl-3">
        <FileCode2 className="size-3.5 shrink-0" />
        {title}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-500" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> Copy
            </>
          )}
        </button>
      </div>

      <HighlightedCode
        code={code}
        language={language}
        className="p-3.5 text-[12.5px] leading-relaxed"
      />
    </div>
  );
}

export function CodeBlock({
  code,
  label = "JavaScript",
  language = "tsx",
  className,
}: {
  code: string;
  label?: string;
  language?: string;
  className?: string;
}) {
  return (
    <Frame
      code={code}
      language={language}
      className={className}
      title={<span className="font-mono text-[11px] tracking-wide uppercase">{label}</span>}
    />
  );
}

export interface CodeVariant {
  /** Tab label, e.g. "withScope". */
  label: string;
  code: string;
  language?: string;
}

/**
 * The same example written two ways, switched in place.
 *
 * Stacking both blocks would make the longer one look like more work for
 * its own sake; flipping between them in the same frame makes the
 * difference the only thing that moves.
 */
export function CodeTabs({
  variants,
  className,
  testId,
}: {
  variants: CodeVariant[];
  className?: string;
  testId?: string;
}) {
  const [index, setIndex] = useState(0);
  const active = variants[Math.min(index, variants.length - 1)]!;

  return (
    <Frame
      code={active.code}
      language={active.language ?? "tsx"}
      className={className}
      testId={testId}
      title={
        <div
          role="tablist"
          aria-label="Code style"
          className="flex min-w-0 items-center gap-0.5 overflow-hidden rounded-md border p-0.5"
        >
          {variants.map((variant, i) => (
            <button
              key={variant.label}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className="truncate rounded px-2 py-0.5 font-mono text-[11px] font-medium transition-colors"
            >
              {variant.label}
            </button>
          ))}
        </div>
      }
    />
  );
}
