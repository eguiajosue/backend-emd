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
      get: jest.fn().mockReturnValue('fake-resend-api-key'),
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
    configService.get.mockReturnValue(undefined);

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

    expect(result).toEqual({ success: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('eguiajosue@gmail.com');
    expect(call.from).toContain('EMD Bordados');
    expect(call.subject).toContain('jdoe');
    expect(call.text).toContain('el botón X no funciona');
  });

  it('devuelve un mensaje genérico si Resend responde con error', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'API key inválida', name: 'validation_error' },
    });

    await expect(
      service.create({ description: 'algo falló' }, activeUser),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('devuelve un mensaje genérico si Resend lanza una excepción', async () => {
    sendMock.mockRejectedValue(new Error('network down'));

    await expect(
      service.create({ description: 'algo falló' }, activeUser),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
