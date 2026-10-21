import { ForbiddenException, HttpStatus } from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpExceptionFilter } from './http-exception.filter';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * Late errors after the response was already sent (30s timeout middleware
 * answered 408, then the controller settles): the filters must not write again.
 */
describe('exception filters: response already sent', () => {
  const i18n = {
    translate: jest.fn().mockReturnValue('translated'),
  } as unknown as I18nService;

  function buildHost(headersSent: boolean) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { headersSent, status, json };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'POST',
          url: '/admin/cron-jobs/x/run',
          body: {},
          headers: {},
        }),
      }),
      getType: () => 'http',
    };
    return { host: host as never, status, json };
  }

  describe('AllExceptionsFilter', () => {
    let filter: AllExceptionsFilter;
    let debug: jest.SpyInstance;
    let error: jest.SpyInstance;

    beforeEach(() => {
      filter = new AllExceptionsFilter(i18n);
      debug = jest
        .spyOn((filter as any).logger, 'debug')
        .mockImplementation(() => undefined);
      error = jest
        .spyOn((filter as any).logger, 'error')
        .mockImplementation(() => undefined);
    });

    it.each([
      ['a generic error', new Error('boom')],
      ['an HttpException', new ForbiddenException('nope')],
    ])('does not write again for %s', (_label, exception) => {
      const { host, status, json } = buildHost(true);

      expect(() => filter.catch(exception, host)).not.toThrow();

      expect(status).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    });

    it('still answers 500 when nothing was sent yet', () => {
      const { host, status, json } = buildHost(false);

      filter.catch(new Error('boom'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(json).toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
    });
  });

  describe('HttpExceptionFilter', () => {
    let filter: HttpExceptionFilter;
    let debug: jest.SpyInstance;
    let error: jest.SpyInstance;

    beforeEach(() => {
      filter = new HttpExceptionFilter(i18n);
      debug = jest
        .spyOn((filter as any).logger, 'debug')
        .mockImplementation(() => undefined);
      error = jest
        .spyOn((filter as any).logger, 'error')
        .mockImplementation(() => undefined);
    });

    it.each([
      ['a vanilla HttpException', new ForbiddenException('nope')],
      [
        'an AppException',
        new AppForbiddenException(ErrorCode.INTERNAL_SERVER_ERROR),
      ],
    ])('does not write again for %s', (_label, exception) => {
      const { host, status, json } = buildHost(true);

      expect(() => filter.catch(exception, host)).not.toThrow();

      expect(status).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    });

    it('still answers when nothing was sent yet', () => {
      const { host, status, json } = buildHost(false);

      filter.catch(new ForbiddenException('nope'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(json).toHaveBeenCalled();
    });
  });
});
