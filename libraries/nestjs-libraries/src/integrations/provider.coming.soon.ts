import { BadRequestException } from '@nestjs/common';

export class ProviderComingSoon extends BadRequestException {
  constructor() {
    super('This network is coming soon');
  }
}
