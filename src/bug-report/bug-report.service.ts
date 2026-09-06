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

const REPORT_RECIPIENT = 'eguiajosue@gmail.com';
const REPORT_FROM = 'EMD Bordados <onboarding@resend.dev>';

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
      throw new ServiceUnavailableException(
        'El envío de reportes no está configurado todavía',
      );
    }

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
        from: REPORT_FROM,
        to: REPORT_RECIPIENT,
        subject: `Nuevo reporte de bug — EMD Bordados (${activeUser.username})`,
        text: `Usuario: ${displayName}\nFecha: ${reportedAt.toLocaleString('es-AR')}\n\nDescripción:\n${createBugReportDto.description}`,
        html: `<p><strong>Usuario:</strong> ${displayName}</p><p><strong>Fecha:</strong> ${reportedAt.toLocaleString(
          'es-AR',
        )}</p><p><strong>Descripción:</strong></p><p>${createBugReportDto.description.replace(/\n/g, '<br/>')}</p>`,
      });

      if (result.error) {
        this.logger.error(
          `Error de Resend al enviar reporte de bug: ${JSON.stringify(result.error)}`,
        );
        throw new HttpException(
          'No se pudo enviar el reporte, intentá nuevamente más tarde',
          HttpStatus.BAD_GATEWAY,
        );
      }

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Error inesperado al enviar reporte de bug', error);
      throw new HttpException(
        'No se pudo enviar el reporte, intentá nuevamente más tarde',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
