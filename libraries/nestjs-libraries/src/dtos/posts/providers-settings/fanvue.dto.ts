import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class FanvueDto {
  @IsIn(['subscribers', 'followers-and-subscribers'])
  @JSONSchema({ description: 'Who can view the Fanvue post' })
  audience: 'subscribers' | 'followers-and-subscribers';

  @IsOptional()
  @IsInt()
  @Min(300)
  @JSONSchema({
    description: 'Optional price in cents, minimum 300; requires media',
  })
  price?: number;
}
