import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TrimString } from 'src/common/transformers/empty-to-undefined';
import { DELAY_REASONS, type DelayReason } from '../coordination.rules';

/** Body de `PATCH /coordination/orders/:id/delay-reason`. `reason: null` lo borra. */
export class DelayReasonDto {
  @ValidateIf((o: DelayReasonDto) => o.reason !== null)
  @IsIn(DELAY_REASONS, { message: 'Motivo de atraso inválido' })
  reason: DelayReason | null;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(300)
  note?: string;
}
