import { IsDefined, IsOptional, IsString } from 'class-validator';

export class ConnectIntegrationDto {
  @IsString()
  @IsDefined()
  state: string;

  @IsString()
  @IsDefined()
  code: string;

  @IsString()
  @IsDefined()
  timezone: string;

  @IsString()
  @IsOptional()
  refresh?: string;
}

export class ConnectionSessionDto {
  @IsString()
  @IsDefined()
  state: string;
}
