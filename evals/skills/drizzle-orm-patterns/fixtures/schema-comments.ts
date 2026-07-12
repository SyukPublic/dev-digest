import { pgTable, serial, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';
import { pullRequests } from './pull-requests.js';

// Type used by the API layer for a review comment.
export interface Comment {
  id: number;
  prId: number;
  author: string;
  body: string;
  resolved: boolean;
  createdAt: Date;
}

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  prId: integer('pr_id').notNull().references(pullRequests.id),
  author: text('author').notNull(),
  body: text('body').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
