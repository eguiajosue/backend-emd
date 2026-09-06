import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BugReportService } from './bug-report.service';
import { UserService } from 'src/user/user.service';

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

describe('BugReportService', () => {
  let service: BugReportService;
  let configService: jest.Mocked<ConfigService>;
  let userService: jest.Mocked<UserService>;

  const activeUser = {
    sub: 1,
    username: 'jdoe',
    roles: ['admin'],
  };

  beforeEach(() => {
    sendMock.mockReset();

    configService = {
      get: jest.fn((key: string) =>
        key === 'RESEND_API_KEY' ? 'fake-resend-api-key' : undefined,
      ),
    } as unknown as jest.Mocked<ConfigService>;

    userService = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        firstName: 'Juan',
        lastName: 'Dorado',
        username: 'jdoe',
        roles: [],
      }),
    } as unknown as jest.Mocked<UserService>;

    service = new BugReportService(configService, userService);
  });

  it('devuelve 503 si no está configurada RESEND_API_KEY', async () => {
    configService.get.mockImplementation(() => undefined);

    await expect(
      service.create({ description: 'algo falló' }, activeUser),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('envía el reporte por email con los datos del usuario', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    const result = await service.create(
      { description: 'el botón X no funciona' },
      activeUser,
    );

    expect(result).toEqual({ success: true, id: 'email-1' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('eguiajosue@gmail.com');
    expect(call.from).toContain('EMD Bordados');
    expect(call.subject).toContain('jdoe');
    expect(call.text).toContain('el botón X no funciona');
  });

  it('falla (no reporta éxito) y expone el error real si Resend responde con error', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'API key inválida', name: 'validation_error' },
    });

    await expect(
      service.create({ description: 'algo falló' }, activeUser),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('API key inválida'),
    });
  });

  it('usa BUG_REPORT_RECIPIENT y BUG_REPORT_FROM cuando están configurados', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'RESEND_API_KEY') return 'fake-resend-api-key';
      if (key === 'BUG_REPORT_RECIPIENT') return 'soporte@emd.com';
      if (key === 'BUG_REPORT_FROM') return 'EMD <bugs@emd.com>';
      return undefined;
    });
    sendMock.mockResolvedValue({ data: { id: 'email-2' }, error: null });

    await service.create({ description: 'x' }, activeUser);

    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('soporte@emd.com');
    expect(call.from).toBe('EMD <bugs@emd.com>');
  });

  it('escapa el HTML de la descripción', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-3' }, error: null });

    await service.create(
      { description: '<script>alert(1)</script>' },
      activeUser,
    );

    expect(sendMock.mock.calls[0][0].html).not.toContain('<script>');
  });

  it('falla y expone el error real si Resend lanza una excepción', async () => {
    sendMock.mockRejectedValue(new Error('network down'));

    const promise = service.create({ description: 'algo falló' }, activeUser);
    await expect(promise).rejects.toBeInstanceOf(HttpException);
    await expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('network down'),
    });
  });
});
