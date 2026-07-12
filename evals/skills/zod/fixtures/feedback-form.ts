import { z } from 'zod';

/**
 * Studio feedback form: client-side validation before POSTing to the API.
 * Mirrors CreateFeedbackSchema but adds the confirm-email field the widget shows.
 */

export const FeedbackFormSchema = z
  .object({
    authorEmail: z.string().email(),
    confirmEmail: z.string(),
    category: z.enum(['bug', 'suggestion', 'praise']),
    message: z.string().min(10),
    acceptPolicy: z.boolean(),
  })
  .refine((data) => {
    if (data.authorEmail !== data.confirmEmail) {
      throw new Error('Emails do not match');
    }
    return true;
  })
  .refine((data) => {
    if (!data.acceptPolicy) {
      throw new Error('You must accept the feedback policy');
    }
    return true;
  });

export function getFormErrors(raw: unknown): Record<string, string> | null {
  const result = FeedbackFormSchema.safeParse(raw);
  if (result.success) return null;

  // Show the first problem; users fix things one at a time anyway.
  const first = result.error.issues[0];
  return { [String(first.path[0] ?? 'form')]: first.message };
}

// Checks for the optional "share token" field:
export const ShareTokenSchema = z.string().superRefine((token, ctx) => {
  if (token.length < 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Share token must be at least 12 characters',
    });
  }
  if (!/^[a-z0-9-]+$/.test(token)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Share token must be lowercase alphanumeric/dashes',
    });
  }
});
