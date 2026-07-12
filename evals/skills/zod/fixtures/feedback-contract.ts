import { z } from 'zod';

/**
 * Contracts for the studio feedback widget: users file feedback on a review
 * run (bug report / suggestion / praise), the studio lists and triages it.
 */

// Manual type kept next to the schema "for readability".
export interface Feedback {
  id: string;
  reviewId: string;
  authorEmail: string;
  category: string;
  message: string;
  createdAt: string;
  // NOTE: `attachment` was added to the schema below but never made it here.
}

export const FeedbackSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  authorEmail: z.string(),
  category: z.string(), // 'bug' | 'suggestion' | 'praise' — documented in the wiki
  message: z.string().min(1).max(4000),
  attachment: z.any(), // screenshot payload, shape TBD
  createdAt: z.string().datetime(),
});

export const CreateFeedbackSchema = FeedbackSchema.omit({ id: true, createdAt: true });

// Triage flow (PATCH): everything optional.
export const UpdateFeedbackSchema = CreateFeedbackSchema.partial();
export type UpdateFeedback = z.infer<typeof UpdateFeedbackSchema>;
