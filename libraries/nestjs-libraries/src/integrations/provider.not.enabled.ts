import { HttpException, HttpStatus } from '@nestjs/common';

export class ProviderNotEnabled extends HttpException {
  constructor(identifier: string) {
    super(
      `Provider "${identifier}" is not enabled for new connections`,
      HttpStatus.FORBIDDEN
    );
  }
}
