import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateOrderNoteDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  text: string;
}
