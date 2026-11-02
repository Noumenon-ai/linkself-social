import { IntegrationRepository } from './integration.repository';

jest.mock('../../../upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn(() => ({})) },
}));

describe('Integration credential boundaries', () => {
  const repositoryFor = (model: object) =>
    new IntegrationRepository(
      { model: { integration: model } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

  it('looks up a reconnect by organization and internal ID among live channels', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await repositoryFor({ findFirst }).getIntegrationByInternalId(
      'org',
      'account'
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org', internalId: 'account', deletedAt: null },
    });
  });

  it('only updates live LinkedIn token siblings in the same organization', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'current' });
    const findFirst = jest.fn().mockResolvedValue({ rootInternalId: 'root' });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await repositoryFor({
      upsert,
      findFirst,
      updateMany,
    }).createOrUpdateIntegration(
      undefined,
      true,
      'org',
      'LinkedIn',
      undefined,
      'social',
      'account',
      'linkedin',
      'new-token',
      'new-refresh',
      3600
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { not: 'current' },
        rootInternalId: 'root',
        organizationId: 'org',
        deletedAt: null,
      },
      data: {
        token: 'new-token',
        refreshToken: 'new-refresh',
        refreshNeeded: false,
        tokenExpiration: expect.any(Date),
      },
    });
  });
});

describe('Page selection preserves plan-disabled channels', () => {
  it('does not enable a channel disabled by a LinkSelf downgrade', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'pending' });
    const repository = new IntegrationRepository(
      {
        model: {
          integration: {
            findUnique: jest.fn().mockResolvedValue(null),
            update,
          },
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    expect(
      await repository.updateIntegration(
        'pending',
        {
          organizationId: 'org',
          internalId: 'selected-page',
          name: 'Page',
        },
        true
      )
    ).toEqual({ id: 'pending' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pending' },
      select: { id: true },
      data: {
        organizationId: 'org',
        internalId: 'selected-page',
        name: 'Page',
        deletedAt: null,
        refreshNeeded: false,
      },
    });
  });
});

describe('Existing page reconnect disabled state', () => {
  it.each([true, false])(
    'preserves a disabled destination only when requested (%s)',
    async (preserveDisabled) => {
      const existing = { id: 'page', disabled: true, token: 'old-token' };
      const fresh = {
        rootInternalId: 'fresh-login',
        refreshToken: 'fresh-refresh',
      };
      const update = jest.fn(async ({ where, data, select }) => {
        if (where.id === existing.id) Object.assign(existing, data);
        return select ? { id: where.id } : existing;
      });
      const repository = new IntegrationRepository(
        {
          model: {
            integration: {
              findUnique: jest
                .fn()
                .mockResolvedValueOnce(existing)
                .mockResolvedValueOnce(fresh),
              update,
            },
          },
        } as any,
        { model: { post: { updateMany: jest.fn() } } } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      await expect(
        repository.updateIntegration(
          'pending',
          {
            organizationId: 'org',
            internalId: 'selected-page',
            token: 'new-token',
          },
          preserveDisabled
        )
      ).resolves.toEqual({ id: 'page' });
      expect(existing.disabled).toBe(preserveDisabled);
      expect(existing.token).toBe('new-token');
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'page' },
          select: { id: true },
          data: expect.objectContaining({
            rootInternalId: 'fresh-login',
            refreshToken: 'fresh-refresh',
          }),
        })
      );
    }
  );
});
