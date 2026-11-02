import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class EnterpriseLimitsRequestDto {
  @IsString()
  @IsNotEmpty()
  params: string;
}

export class OrganizationLimitsDto {
  @IsString()
  @IsNotEmpty()
  orgId: string;

  @IsIn(['free', 'starter', 'pro'])
  plan: 'free' | 'starter' | 'pro';

  @IsInt()
  @Min(-1)
  @Max(2147483647)
  channels: number;

  @IsInt()
  @Min(-1)
  @Max(2147483647)
  postsPerMonth: number;

  @IsBoolean()
  mcp: boolean;

  @IsInt()
  iat: number;

  @IsInt()
  exp: number;

  @IsString()
  @IsNotEmpty()
  jti: string;
}

export interface OrganizationLimitsResponse {
  plan: string;
  channels: number;
  channelsUsed: number;
  postsPerMonth: number;
  postsUsed: number;
  mcp: boolean;
}
