import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Raíz de la API.
 *
 * Sin esta ruta, cada ping del monitor de Render (y cualquier visita al
 * dominio) quedaba en el log como `HEAD / -> 404` / `GET / -> 404`, ruido que
 * tapa los 404 que sí importan. Devuelve un descriptor mínimo y apunta a la
 * documentación; no expone datos ni requiere auth.
 */
@ApiTags('root')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Descriptor de la API' })
  root() {
    return {
      name: 'EMD Bordados API',
      status: 'ok',
      docs: '/api/docs',
      health: '/health',
    };
  }
}
