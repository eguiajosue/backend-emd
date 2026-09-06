import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { UserService } from 'src/user/user.service';
import { CreateBugReportDto } from './dto/create-bug-report.dto';
import type { AccessTokenPayload } from 'src/auth/auth.service';

/**
 * Destinatario y remitente por defecto.
 *
 * OJO con el remitente: `onboarding@resend.dev` es el dominio compartido de
 * pruebas de Resend y SOLO permite entregar al email con el que se registró la
 * cuenta de Resend. Si el reporte tiene que llegar a otra casilla hay que
 * verificar un dominio propio en Resend y definir BUG_REPORT_FROM con una
 * dirección de ese dominio.
 */
const DEFAULT_REPORT_RECIPIENT = 'eguiajosue@gmail.com';
const DEFAULT_REPORT_FROM = 'EMD Bordados <onboarding@resend.dev>';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

@Injectable()
export class BugReportService {
  private readonly logger = new Logger('BugReportService');

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  async create(
    createBugReportDto: CreateBugReportDto,
    activeUser: AccessTokenPayload,
  ) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'RESEND_API_KEY no está definida: el reporte de bug NO se envió. ' +
          'Definí RESEND_API_KEY en las variables de entorno del servicio.',
      );
      throw new ServiceUnavailableException(
        'El envío de reportes no está configurado todavía (falta RESEND_API_KEY)',
      );
    }

    const to =
      this.configService.get<string>('BUG_REPORT_RECIPIENT') ??
      DEFAULT_REPORT_RECIPIENT;
    const from =
      this.configService.get<string>('BUG_REPORT_FROM') ?? DEFAULT_REPORT_FROM;

    const resend = new Resend(apiKey);

    const user = await this.userService.findOne(activeUser.sub);
    const fullName = [user?.firstName, user?.lastName]
      .filter(Boolean)
      .join(' ');
    const displayName = fullName
      ? `${fullName} (${activeUser.username})`
      : activeUser.username;
    const reportedAt = new Date();

    try {
      const result = await resend.emails.send({
        from,
        to,
        subject: `Nuevo reporte de bug — EMD Bordados (${activeUser.username})`,
        text: `Usuario: ${displayName}\nFecha: ${reportedAt.toLocaleString('es-AR')}\n\nDescripción:\n${createBugReportDto.description}`,
        html: `<p><strong>Usuario:</strong> ${escapeHtml(displayName)}</p><p><strong>Fecha:</strong> ${reportedAt.toLocaleString(
          'es-AR',
        )}</p><p><strong>Descripción:</strong></p><p>${escapeHtml(
          createBugReportDto.description,
        ).replace(/\n/g, '<br/>')}</p>`,
      });

      if (result.error) {
        // El SDK de Resend NO lanza: devuelve { data: null, error }. Si esto no
        // se revisa, el envío falla en silencio y el cliente ve un 201 exitoso.
        const providerMessage =
          result.error.message ?? JSON.stringify(result.error);
        this.logger.error(
          `Resend rechazó el envío del reporte (from="${from}", to="${to}", ` +
            `error=${result.error.name ?? 'desconocido'}): ${providerMessage}`,
        );
        throw new HttpException(
          `No se pudo enviar el reporte por email: ${providerMessage}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.log(
        `Reporte de bug enviado a ${to} (id: ${result.data?.id ?? 'sin id'})`,
      );
      return { success: true, id: result.data?.id };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const providerMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error inesperado al enviar el reporte de bug (from="${from}", to="${to}"): ${providerMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        `No se pudo enviar el reporte por email: ${providerMessage}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
