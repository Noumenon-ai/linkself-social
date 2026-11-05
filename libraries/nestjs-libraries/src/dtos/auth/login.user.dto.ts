import {
  IsDefined,
  IsIn,
  IsEmail,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Provider } from '@prisma/client';

export class LoginUserDto {
  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
  @MinLength(3)
  password: string;

  @IsString()
  @IsDefined()
  @IsIn(Object.values(Provider))
  provider: Provider;

  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.password)
  providerToken: string;

  @IsEmail()
  @IsDefined()
  email: string;

  datafast_visitor_id: string;
}
