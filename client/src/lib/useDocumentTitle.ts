import React from "react";

/**
 * Sync `document.title` with a page-specific title, restoring the previous title
 * on unmount. For client pages (`'use client'`) where Next's `generateMetadata`
 * isn't available — gives dynamic routes (a PR, an agent) a real browser-tab
 * title for bookmarks/history/tab identification. A nullish title is a no-op, so
 * it's safe to call before data has loaded.
 */
export function useDocumentTitle(title: string | null | undefined) {
  React.useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
