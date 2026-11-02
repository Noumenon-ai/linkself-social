import { IntegrationRepository } from './integration.repository';

jest.mock('../../../upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn(() => ({})) },
}));

describe('Disconnecting a channel', () => {
  it('keeps the row for post history but clears the network credentials', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'int-1' });
    const repository = new IntegrationRepository(
      { model: { integration: { update } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await repository.deleteChannel('org-1', 'int-1');

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'int-1', organizationId: 'org-1' });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(call.data.token).toBe('');
    expect(call.data.refreshToken).toBeNull();
    expect(call.data.tokenExpiration).toBeNull();
    expect(call.data.customInstanceDetails).toBeNull();
    expect(call.select).toEqual({ id: true });
  });

  it('only touches the channel inside the caller organization', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'int-2' });
    const repository = new IntegrationRepository(
      { model: { integration: { update } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await repository.deleteChannel('org-other', 'int-2');

    expect(update.mock.calls[0][0].where.organizationId).toBe('org-other');
  });
});
