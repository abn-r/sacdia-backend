/**
 * xlsx costs ~25-40 MiB RSS. It must NOT be loaded when AdminUsersService is
 * imported (application boot) and must be loaded on first real use.
 */
describe('AdminUsersService xlsx lazy loading', () => {
  const xlsxLoaded = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    xlsxLoaded.mockClear();
    jest.doMock('xlsx', () => {
      xlsxLoaded();
      return jest.requireActual('xlsx');
    });
  });

  afterEach(() => {
    jest.dontMock('xlsx');
  });

  function loadService() {
    const { AdminUsersService } = require('./admin-users.service') as {
      AdminUsersService: new (...args: unknown[]) => any;
    };
    const service = new AdminUsersService({}, {}, {}, {}, {});
    jest
      .spyOn(service, 'getAllowedTargetRolesForActor')
      .mockResolvedValue(['user', 'assistant-lf']);
    return service;
  }

  it('does not load xlsx when the service module is imported or instantiated', () => {
    loadService();

    expect(xlsxLoaded).not.toHaveBeenCalled();
  });

  it('loads xlsx on first template download and builds a valid workbook', async () => {
    const service = loadService();

    const buffer: Buffer = await service.getBulkTemplateBuffer('actor-1');

    expect(xlsxLoaded).toHaveBeenCalledTimes(1);
    // Real xlsx output: ZIP container ("PK") and the expected sheets.
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const XLSX = jest.requireActual('xlsx') as typeof import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Usuarios', 'Roles permitidos']);
  });

  it('keeps the loaded module cached across calls', async () => {
    const service = loadService();

    await service.getBulkTemplateBuffer('actor-1');
    await service.getBulkTemplateBuffer('actor-1');

    expect(xlsxLoaded).toHaveBeenCalledTimes(1);
  });
});
