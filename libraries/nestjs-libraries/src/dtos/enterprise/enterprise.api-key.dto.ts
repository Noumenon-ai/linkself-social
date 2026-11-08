import { IsNotEmpty, IsString } from 'class-validator';

export class EnterpriseApiKeyRequestDto {
  @IsString()
  @IsNotEmpty()
  params: string;
}

export interface EnterpriseApiKeyClaims {
  organizationId: string;
  iat: number;
  exp: number;
  jti: string;
}
