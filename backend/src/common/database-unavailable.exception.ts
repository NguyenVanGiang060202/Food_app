import { HttpException, HttpStatus } from '@nestjs/common';

export class DatabaseUnavailableException extends HttpException {
    constructor() {
        super(
            {
                error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message: 'The restaurant catalog is temporarily unavailable.',
                },
            },
            HttpStatus.SERVICE_UNAVAILABLE,
        );
    }
}