import { and, desc, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { AgentsRepository } from '../agents/repository.js';
import { NotificationsRepository, type NotificationRow } from './repository.js';

/**
 * Notifications service. Produces in-studio notifications for finished review
 * runs and exposes the unread feed shown in the header bell.
 */

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export class NotificationsService {
  private repo: NotificationsRepository;

  constructor(private container: Container) {
    this.repo = new NotificationsRepository(container.db);
  }

  async list(workspaceId: string): Promise<NotificationDto[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toDto);
  }

  async listUnread(workspaceId: string): Promise<NotificationDto[]> {
    const rows = await this.container.db
      .select()
      .from(t.notifications)
      .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.read, false)))
      .orderBy(desc(t.notifications.createdAt))
      .limit(50);
    return rows.map(toDto);
  }

  async markRead(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.markRead(workspaceId, id);
  }

  /** Create the "review completed" notification for a finished run. */
  async notifyReviewCompleted(
    workspaceId: string,
    input: { repoFullName: string; prNumber: number; agentId: string; score: number },
  ): Promise<NotificationDto> {
    const github = new OctokitGitHubClient(process.env.GITHUB_TOKEN ?? '');
    const [owner, repoName] = input.repoFullName.split('/');
    const pr = await github.getPullRequest(owner!, repoName!, input.prNumber);

    const agentsRepo = new AgentsRepository(this.container.db);
    const agent = await agentsRepo.getById(workspaceId, input.agentId);

    const row = await this.repo.insert({
      workspaceId,
      kind: 'review_completed',
      title: `${agent?.name ?? 'Agent'} reviewed #${input.prNumber}: ${pr.title}`,
      body: `Score ${input.score} on ${input.repoFullName}.`,
    });
    return toDto(row);
  }
}

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}
