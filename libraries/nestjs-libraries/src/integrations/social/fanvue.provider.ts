import { frontendUrl } from '@gitroom/helpers/utils/base-path';
import { createHash, randomBytes } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Integration } from '@prisma/client';
import { timer } from '@gitroom/helpers/utils/timer';
import { FanvueDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/fanvue.dto';
import {
  BadBody,
  NotEnoughScopes,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  AuthTokenDetails,
  MediaContent,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// Contract: https://api.fanvue.com/docs/openapi-v1.json
const API = 'https://api.fanvue.com/v1';
const API_VERSION = '2025-06-26';

export class FanvueProvider extends SocialAbstract implements SocialProvider {
  identifier = 'fanvue';
  name = 'Fanvue';
  override maxConcurrentJob = 3;
  isBetweenSteps = false;
  editor = 'normal' as const;
  dto = FanvueDto;
  scopes = [
    'openid',
    'offline_access',
    'offline',
    'read:self',
    'write:post',
    'write:media',
    'read:media',
  ];

  maxLength() {
    return 5000;
  }

  private credentials() {
    const clientId = process.env.FANVUE_CLIENT_ID;
    const clientSecret = process.env.FANVUE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        'Fanvue requires FANVUE_CLIENT_ID and FANVUE_CLIENT_SECRET'
      );
    }
    return { clientId, clientSecret };
  }

  private redirectUri() {
    if (!process.env.FRONTEND_URL) {
      throw new Error('Fanvue requires FRONTEND_URL');
    }
    return `${frontendUrl()}/integrations/social/fanvue`;
  }

  async generateAuthUrl() {
    const { clientId } = this.credentials();
    const codeVerifier = randomBytes(64).toString('base64url');
    const state = randomBytes(32).toString('hex');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: this.scopes.join(' '),
      state,
      code_challenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      code_challenge_method: 'S256',
    });
    return {
      url: `https://auth.fanvue.com/oauth2/auth?${query}`,
      codeVerifier,
      state,
    };
  }

  override handleErrors(body: string, status: number) {
    if (
      status === 401 ||
      status === 403 ||
      body.includes('invalid_grant') ||
      body.includes('invalid_token')
    ) {
      return {
        type: 'refresh-token' as const,
        value: 'Reconnect Fanvue to renew access and required permissions',
      };
    }
    if (status >= 400 && status < 500 && status !== 429) {
      return {
        type: 'bad-body' as const,
        value: 'Fanvue rejected the request; check the post settings and media',
      };
    }
    return undefined;
  }

  private badBody(message: string): never {
    throw new BadBody(this.identifier, '{}', '{}', message);
  }

  private request(url: string, options: RequestInit): Promise<Response> {
    return this.fetch(url, options, this.identifier);
  }

  private async json(response: Response) {
    try {
      return await response.json();
    } catch {
      this.badBody('Fanvue returned an invalid response');
    }
  }

  private api(path: string, token: string, options: RequestInit = {}) {
    return this.request(`${API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Fanvue-API-Version': API_VERSION,
        'Content-Type': 'application/json',
      },
    });
  }

  private async tokens(body: URLSearchParams) {
    const { clientId, clientSecret } = this.credentials();
    const data = await this.json(
      await this.request('https://auth.fanvue.com/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Fanvue-API-Version': API_VERSION,
        },
        body,
      })
    );
    if (
      !data.access_token ||
      !data.refresh_token ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    ) {
      this.badBody('Fanvue did not return valid access and refresh tokens');
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }): Promise<AuthTokenDetails> {
    const { scope, ...tokens } = await this.tokens(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        code_verifier: params.codeVerifier,
        redirect_uri: this.redirectUri(),
      })
    );
    // openid, offline_access and offline are system scopes added to every
    // grant; Fanvue says to read the granted field, so check only the API scopes.
    this.checkScopes(
      this.scopes.filter((s) => s.includes(':')),
      typeof scope === 'string' ? scope : ''
    );
    const user = await this.json(
      await this.api('/users/me', tokens.accessToken)
    );
    if (!user.uuid || !user.isCreator) {
      throw new NotEnoughScopes(
        'Connect a Fanvue creator account to publish posts'
      );
    }
    return {
      ...tokens,
      id: user.uuid,
      name: user.displayName || user.handle,
      username: user.handle,
      picture: user.avatarUrl || '',
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { scope, ...tokens } = await this.tokens(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    );
    // Return rotated credentials immediately. The integration service preserves
    // identity and persists both tokens; a profile request here could lose them.
    return { ...tokens, id: '', name: '', username: '' };
  }

  override async checkValidity(posts: ValidityMedia[][], settings: FanvueDto) {
    if (posts.length !== 1)
      return 'Fanvue supports a single post without comments';
    if (settings?.price != null && !posts[0]?.length)
      return 'Paid Fanvue posts require an image or video';
    return true;
  }

  private async uploadMedia(
    media: MediaContent,
    token: string
  ): Promise<string> {
    const sizeBytes = await this.mediaSize(media.path, this.identifier);
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > 1610612736
    ) {
      this.badBody('Fanvue media must be between 1 byte and 1.5 GiB');
    }
    const filename = (
      media.path.split('?')[0].split('/').pop() || 'media'
    ).slice(0, 255);
    const session = await this.json(
      await this.api('/media/uploads', token, {
        method: 'POST',
        body: JSON.stringify({
          name: filename,
          filename,
          mediaType: media.type,
          sizeBytes,
        }),
      })
    );
    const { partSize, maxParts, mediaUuid, uploadId } = session;
    const totalParts = Math.ceil(sizeBytes / partSize);
    if (
      !mediaUuid ||
      !uploadId ||
      !Number.isSafeInteger(partSize) ||
      partSize <= 0 ||
      !Number.isSafeInteger(maxParts) ||
      totalParts > maxParts ||
      (session.totalParts != null && session.totalParts !== totalParts)
    ) {
      this.badBody('Fanvue returned an invalid upload session');
    }
    const uploadPath = `/media/uploads/${encodeURIComponent(uploadId)}`;
    const parts: { PartNumber: number; ETag: string }[] = [];
    // Sign small batches so URLs do not expire during large video uploads.
    for (let from = 1; from <= totalParts; from += 10) {
      const to = Math.min(from + 9, totalParts);
      const signed = await this.json(
        await this.api(`${uploadPath}/parts/urls?from=${from}&to=${to}`, token)
      );
      for (let partNumber = from; partNumber <= to; partNumber++) {
        const url = signed.parts?.find(
          (part: { partNumber: number }) => part.partNumber === partNumber
        )?.url;
        if (typeof url !== 'string' || !url.startsWith('https://'))
          this.badBody('Fanvue returned an invalid upload URL');
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, sizeBytes) - 1;
        const body = await this.mediaChunk(
          media.path,
          start,
          end,
          this.identifier
        );
        if (body.length !== end - start + 1)
          this.badBody('Could not read the complete media part');
        const uploaded = await this.request(url, { method: 'PUT', body });
        const ETag = uploaded.headers.get('etag');
        if (!ETag) this.badBody('Fanvue upload did not return a part ETag');
        parts.push({ PartNumber: partNumber, ETag });
      }
    }
    const completed = await this.json(
      await this.api(uploadPath, token, {
        method: 'PATCH',
        body: JSON.stringify({ parts }),
      })
    );
    let status = completed.status;
    for (let attempt = 0; attempt <= 60; attempt++) {
      if (status === 'ready') return mediaUuid;
      if (status === 'error')
        this.badBody('Fanvue could not process the media');
      if (status !== 'processing' && status !== 'created')
        this.badBody('Fanvue returned an invalid media status');
      if (attempt === 60) break;
      await timer(5000);
      const result = await this.json(
        await this.api(`/media/${encodeURIComponent(mediaUuid)}`, token)
      );
      status = result.status;
    }
    this.badBody('Fanvue media processing timed out; please try again later');
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FanvueDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [post] = postDetails;
    const errors = await validate(
      plainToInstance(FanvueDto, post?.settings || {})
    );
    if (errors.length)
      this.badBody(
        'Choose a Fanvue audience and, optionally, a whole-cent price of at least 300'
      );
    const validity = await this.checkValidity(
      postDetails.map((p) => p.media || []),
      post.settings
    );
    if (validity !== true) this.badBody(validity);
    if (
      typeof post.message !== 'string' ||
      post.message.length > this.maxLength() ||
      (!post.message.trim() && !post.media?.length)
    ) {
      this.badBody(
        'Fanvue posts require text or media, with at most 5000 characters'
      );
    }
    if (post.media?.some((m) => !['image', 'video'].includes(m.type)))
      this.badBody('Fanvue supports images and video');
    const mediaUuids: string[] = [];
    for (const media of post.media || [])
      mediaUuids.push(await this.uploadMedia(media, accessToken));
    const data = await this.json(
      await this.api('/posts', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          text: post.message,
          audience: post.settings.audience,
          ...(mediaUuids.length ? { mediaUuids } : {}),
          ...(post.settings.price != null
            ? { price: post.settings.price }
            : {}),
        }),
      })
    );
    if (!data.uuid) this.badBody('Fanvue did not return a post ID');
    // The current spec has no permalink. Preserve one if the API supplies it,
    // without inventing a route from the UUID.
    return [
      {
        id: post.id,
        postId: data.uuid,
        releaseURL: typeof data.url === 'string' ? data.url : '',
        status: 'success',
      },
    ];
  }
}
