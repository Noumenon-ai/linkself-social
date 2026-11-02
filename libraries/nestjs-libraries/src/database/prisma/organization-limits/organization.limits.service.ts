import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  OrganizationLimitsDto,
  OrganizationLimitsResponse,
} from '@gitroom/nestjs-libraries/dtos/enterprise/organization.limits.dto';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { OrganizationLimitsRepository } from './organization.limits.repository';
import { IntegrationRepository } from '../integrations/integration.repository';

export const LINKSELF_FREE_LIMITS = Object.freeze({
  plan: 'free',
  channels: 3,
  postsPerMonth: 30,
  mcp: false,
});
const UNLIMITED = Object.freeze({
  plan: 'unlimited',
  channels: -1,
  postsPerMonth: -1,
  mcp: true,
});

@Injectable()
export class OrganizationLimitsService {
  constructor(
    private _repository: OrganizationLimitsRepository,
    private _integrations: IntegrationRepository
  ) {}

  async get(orgId: string) {
    if (!process.env.LINKSELF_URL) return UNLIMITED;
    return (await this._repository.get(orgId)) || LINKSELF_FREE_LIMITS;
  }

  async set(payload: OrganizationLimitsDto) {
    const limits = plainToInstance(OrganizationLimitsDto, payload);
    const now = Math.floor(Date.now() / 1000);
    if (
      validateSync(limits).length ||
      limits.exp <= now ||
      limits.iat > now ||
      limits.exp <= limits.iat ||
      limits.exp - limits.iat > 60
    ) {
      throw new BadRequestException('Invalid limits token claims');
    }
    if (!(await this._repository.exists(limits.orgId))) {
      throw new NotFoundException('Organization not found');
    }
    const previous = await this.get(limits.orgId);
    if (process.env.LINKSELF_URL) {
      const active = await this._repository.countChannels(limits.orgId, true);
      const total = await this._repository.countChannels(limits.orgId);
      // Same disable/re-enable pattern as IntegrationService subscription changes.
      if (limits.channels !== -1 && active > limits.channels) {
        await this._integrations.disableIntegrations(
          limits.orgId,
          active - limits.channels
        );
      }
      if (
        active < total &&
        (limits.channels === -1 || total <= limits.channels) &&
        previous.channels !== -1 &&
        (limits.channels === -1 || limits.channels > previous.channels)
      ) {
        await this._integrations.enableAllIntegrations(limits.orgId);
      }
    }
    await this._repository.upsert(limits);
    return { ok: true };
  }

  countPosts(orgId: string) {
    const now = new Date();
    return this._repository.countPosts(
      orgId,
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    );
  }

  async getUsage(orgId: string): Promise<OrganizationLimitsResponse> {
    const [limits, channelsUsed, postsUsed] = await Promise.all([
      this.get(orgId),
      this._repository.countChannels(orgId),
      this.countPosts(orgId),
    ]);
    return { ...limits, channelsUsed, postsUsed };
  }

  async assertCanConnect(orgId: string) {
    const { channels } = await this.get(orgId);
    if (
      channels !== -1 &&
      (await this._repository.countChannels(orgId)) >= channels
    ) {
      throw this.channelError(channels);
    }
  }

  channelError(channels: number) {
    return new ForbiddenException(
      `Your LinkSelf plan includes ${channels} channels. Upgrade in LinkSelf to connect more.`
    );
  }

  async assertCanEnable(orgId: string) {
    const { channels } = await this.get(orgId);
    if (
      channels !== -1 &&
      (await this._repository.countChannels(orgId, true)) >= channels
    ) {
      throw this.channelError(channels);
    }
  }

  async assertCanCreatePosts(orgId: string, body: CreatePostDto) {
    const { postsPerMonth } = await this.get(orgId);
    if (postsPerMonth === -1) return;
    const ids = body.posts.flatMap((post) =>
      post.value.map((value) => value.id).filter(Boolean)
    );
    const groups = body.posts.map((post) => post.group).filter(Boolean);
    const existing =
      ids.length || groups.length
        ? await this._repository.existingPosts(orgId, ids, groups)
        : [];
    // Editing an owned post or group does not consume new-post allowance.
    const newRows = body.posts.reduce((count, post) => {
      const editing = existing.some(
        (row) =>
          row.integrationId === post.integration.id &&
          ((post.group && row.group === post.group) ||
            post.value.some((value) => value.id === row.id))
      );
      return count + (editing ? 0 : post.value.length);
    }, 0);
    if (newRows && (await this.countPosts(orgId)) + newRows > postsPerMonth) {
      throw new ForbiddenException(
        `Your LinkSelf plan includes ${postsPerMonth} posts a month. Upgrade in LinkSelf for unlimited posts.`
      );
    }
  }

  async assertMcp(orgId: string) {
    if (!(await this.get(orgId)).mcp) {
      throw new ForbiddenException(
        'Your LinkSelf plan does not include AI agents through MCP. Upgrade in LinkSelf to use MCP.'
      );
    }
  }
}
