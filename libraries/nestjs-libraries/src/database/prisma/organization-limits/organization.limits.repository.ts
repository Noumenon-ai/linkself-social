import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '../prisma.service';
import { OrganizationLimitsDto } from '@gitroom/nestjs-libraries/dtos/enterprise/organization.limits.dto';

@Injectable()
export class OrganizationLimitsRepository {
  constructor(
    private _limits: PrismaRepository<'organizationLimits'>,
    private _organization: PrismaRepository<'organization'>,
    private _integration: PrismaRepository<'integration'>,
    private _post: PrismaRepository<'post'>
  ) {}

  exists(organizationId: string) {
    return this._organization.model.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { id: true },
    });
  }

  get(organizationId: string) {
    return this._limits.model.organizationLimits.findUnique({
      where: { organizationId },
      select: { plan: true, channels: true, postsPerMonth: true, mcp: true },
    });
  }

  upsert({
    orgId: organizationId,
    plan,
    channels,
    postsPerMonth,
    mcp,
  }: OrganizationLimitsDto) {
    const data = { plan, channels, postsPerMonth, mcp };
    return this._limits.model.organizationLimits.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
      select: { organizationId: true },
    });
  }

  countChannels(organizationId: string, activeOnly = false) {
    return this._integration.model.integration.count({
      where: {
        organizationId,
        deletedAt: null,
        ...(activeOnly ? { disabled: false } : {}),
      },
    });
  }

  countPosts(organizationId: string, start: Date, end: Date) {
    return this._post.model.post.count({
      where: {
        organizationId,
        deletedAt: null,
        createdAt: { gte: start, lt: end },
      },
    });
  }

  existingPosts(organizationId: string, ids: string[], groups: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ id: { in: ids } }, { group: { in: groups } }],
      },
      select: { id: true, group: true, integrationId: true },
    });
  }
}
