import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'AuthorRefResponse' })
export class PersonRefResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  userId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Алия' })
  displayName!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'False когда человек исключён из рабочего пространства или вышел из него.',
  })
  isActiveMember!: boolean;
}
