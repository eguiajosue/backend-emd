import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  EmptyToUndefined,
  TrimString,
} from 'src/common/transformers/empty-to-undefined';

/**
 * POST /orders/:id/start-design. `name` hace falta sólo desde la cuenta
 * compartida del área (la usan varias personas): es quien empieza de verdad.
 */
export class StartDesignDto {
  @IsOptional()
  @TrimString()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(60)
  name?: string;
}
