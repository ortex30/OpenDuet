import katex from "katex";
import type { ReactNode } from "react";

const TOKEN =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([^)]+?)\\\)|https?:\/\/[^\s<>"']+/g;

/** Page text with math drawn by KaTeX, and source URLs as links. Model text is never HTML. */
export function PageText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const display = match[1] ?? match[2];
    const inline = match[3] ?? match[4];
    if (display !== undefined || inline !== undefined) {
      const tex = (display ?? inline ?? "").trim();
      if (!tex) continue;
      if (start > cursor) parts.push(text.slice(cursor, start));
      parts.push(
        <MathTex key={start} tex={tex} display={display !== undefined} />,
      );
      cursor = start + match[0].length;
      continue;
    }
    let source = match[0].replace(/[.,;:!?]+$/, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
    ]) {
      while (
        source.endsWith(close) &&
        source.split(close).length > source.split(open).length
      ) {
        source = source.slice(0, -1);
      }
    }
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      continue;
    }
    if (url.username || url.password) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <a
        key={start}
        href={url.href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {source}
      </a>,
    );
    cursor = start + source.length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function MathTex({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, {
    throwOnError: false,
    displayMode: display,
    trust: false,
    strict: "ignore",
  });
  return (
    <span
      className={display ? "my-2 block overflow-x-auto" : undefined}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX draws one math expression. The model text around it stays plain.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
