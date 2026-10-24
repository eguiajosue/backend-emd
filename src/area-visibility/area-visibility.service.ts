import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AreaService, type AreaView } from 'src/area/area.service';

/** Forma histórica de `/area-visibility` (una fila por área). */
export interface AreaVisibilityView {
  id: number;
  role: string;
  generalViewEnabled: boolean;
}

function toView(area: AreaView): AreaVisibilityView {
  return {
    id: area.id,
    role: area.slug,
    generalViewEnabled: area.generalViewEnabled,
  };
}

/**
 * Visibilidad general de cada área. Vive en `Area.generalViewEnabled`; este
 * servicio conserva la forma de respuesta de siempre (`role` = slug del área)
 * para los clientes que todavía la consumen.
 */
@Injectable()
export class AreaVisibilityService {
  constructor(private readonly areaService: AreaService) {}

  async findAll(): Promise<AreaVisibilityView[]> {
    return (await this.areaService.findAll()).map(toView);
  }

  async update(
    role: string,
    generalViewEnabled: boolean,
  ): Promise<AreaVisibilityView> {
    const area = await this.areaService.setGeneralView(
      role,
      generalViewEnabled,
    );
    if (!area) {
      const valid = await this.areaService.slugs();
      throw new HttpException(
        `Área inválida: "${role}". Debe ser una de: ${valid.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return toView(area);
  }
}
