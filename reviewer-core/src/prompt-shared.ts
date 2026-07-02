/**
 * prompt-shared.ts — leaf helpers shared by the prompt builders.
 *
 * PURE (reviewer-core invariant): no I/O. Extracted here so prompt.ts and the
 * intent/blast/risks/conventions builders can share `wrapUntrusted` WITHOUT the
 * prompt.ts ⇄ intent/classify-prompt.ts value cycle (prompt.ts imports
 * INTENT_RULE from classify-prompt; classify-prompt needs wrapUntrusted — putting
 * the helper in a leaf makes the graph one-way). See TD-001 Group C.
 */
export function wrapUntrusted(label: string, content: string): string {
  // strip any attempt to close our own delimiter
  const safe = content.replaceAll('</untrusted>', '<\\/untrusted>');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
