import {
  Allow,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  UPLOAD_ALLOWED_MIME,
  getMaxSize,
} from '@gitroom/nestjs-libraries/upload/custom.upload.validation';

export class StartChunkedUploadDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  @Max(getMaxSize('video/mp4'))
  size: number;

  @IsIn([...UPLOAD_ALLOWED_MIME])
  mimeType: string;
}

export class CompleteChunkedUploadDto {
  // Validated against the stored upload in the provider, with cleanup on failure.
  @Allow()
  partCount: number;

  @Allow()
  preventSave?: boolean;
}
