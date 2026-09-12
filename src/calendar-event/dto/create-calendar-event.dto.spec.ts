import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCalendarEventDto } from './create-calendar-event.dto';

describe('CreateCalendarEventDto', () => {
  const base = {
    title: 'Instalar anuncio',
    eventDate: '2026-09-15T15:00:00.000Z',
  };

  it('acepta el caso mínimo (sólo título y fecha)', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, { ...base });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza sin título', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      eventDate: base.eventDate,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });

  it('rechaza una fecha inválida', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      ...base,
      eventDate: 'no-es-una-fecha',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'eventDate')).toBe(true);
  });

  it('normaliza clientName vacío a undefined en vez de rechazarlo', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      ...base,
      clientName: '   ',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.clientName).toBeUndefined();
  });

  it('rechaza reminderMinutesBefore no positivo', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      ...base,
      reminderMinutesBefore: 0,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reminderMinutesBefore')).toBe(
      true,
    );
  });

  it('acepta una categoría válida', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      ...base,
      category: 'junta',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza una categoría que no existe', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      ...base,
      category: 'cumpleanos',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('acepta un área de producción válida', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      ...base,
      area: 'bordado',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza un área que no existe', async () => {
    const dto = plainToInstance(CreateCalendarEventDto, {
      ...base,
      area: 'cocina',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'area')).toBe(true);
  });
});
