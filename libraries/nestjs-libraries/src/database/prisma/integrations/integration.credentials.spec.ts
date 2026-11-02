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
