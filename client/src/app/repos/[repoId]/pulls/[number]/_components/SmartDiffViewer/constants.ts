/* SmartDiffViewer per-module constants (per-module `constants.ts` convention). */

/** How long the transient whole-range deep-link highlight stays applied before
    it fades out, in milliseconds. A short attention flash — not persistent
    state — so it clears on its own after the jump lands. Skipped entirely under
    `prefers-reduced-motion` (AC-9). */
export const DEEP_LINK_HIGHLIGHT_MS = 1600;

/** Inline background applied to each rendered line of the deep-link target range
    while the highlight is active. A tinted accent wash that reads as a transient
    locator; the always-present focus move (not this color) is the accessible cue
    (AC-9). Kept as a token so tests can assert the highlight is applied/cleared. */
export const DEEP_LINK_HIGHLIGHT_BG = "var(--accent-bg)";
