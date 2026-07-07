/* InDiffLink — the INTERNAL in-diff jump affordance shared by the two brief
   link surfaces (RISK AREAS / REVIEW FOCUS). Styled like the vendored `MonoLink`
   (mono, accent-on-hover) but, unlike it, points at the app's OWN PR route: a
   real same-route `href` (so reload / middle-click / share work — AC-3, US-4)
   whose plain left-click is intercepted to navigate CLIENT-SIDE via the router
   (Overview → Files tab, no full reload).

   SECURITY (AC-11): `href` is always a same-route relative URL built by
   `buildInDiffHref` (app PR route + tab/file/line query keys) — never an
   executable protocol; the children (a ref path/range) render as plain text
   (React auto-escapes; no dangerouslySetInnerHTML). */
"use client";

import React from "react";

/** True for a click that should keep the browser's default (new tab / new window
    / download) rather than a client-side same-tab navigation. */
function isModifiedClick(e: React.MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export function InDiffLink({
  href,
  onNavigate,
  children,
}: {
  /** Same-route relative URL (`/repos/…/pulls/…?tab=diff&file=…[&line=…]`). */
  href: string;
  /** Client-side navigation performed for a plain left-click (router.replace). */
  onNavigate: (href: string) => void;
  children?: React.ReactNode;
}) {
  const [hover, setHover] = React.useState(false);
  const style: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 13,
    cursor: "pointer",
    color: hover ? "var(--accent-text)" : "var(--text-secondary)",
    textDecoration: hover ? "underline" : "none",
    textUnderlineOffset: 2,
  };

  return (
    <a
      className="mono"
      href={href}
      onClick={(e) => {
        // Let modified / non-left clicks fall through to the browser (new tab,
        // etc.) since the href is a valid same-route URL. A plain left-click is
        // an in-app navigation: prevent the default full navigation and push
        // the query state so Overview → Files tab happens without a reload.
        e.stopPropagation();
        if (isModifiedClick(e)) return;
        e.preventDefault();
        onNavigate(href);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={style}
    >
      {children}
    </a>
  );
}
