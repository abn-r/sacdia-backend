import { ApiProperty } from '@nestjs/swagger';

export class LeadershipMemberDto {
  @ApiProperty()
  declare assignment_id: string;

  @ApiProperty()
  declare user_id: string;

  @ApiProperty({ nullable: true, type: String })
  declare name: string | null;

  @ApiProperty({ nullable: true, type: String })
  declare paternal_last_name: string | null;

  @ApiProperty({ nullable: true, type: String })
  declare maternal_last_name: string | null;

  @ApiProperty({ nullable: true, type: String })
  declare user_image: string | null;

  @ApiProperty({ nullable: true, type: String })
  declare email: string | null;

  @ApiProperty()
  declare role_name: string;

  @ApiProperty({ nullable: true, type: String })
  declare section_name: string | null;

  @ApiProperty()
  declare start_date: Date;
}

export class ClubLeadershipResponseDto {
  @ApiProperty({ nullable: true, type: LeadershipMemberDto })
  declare director: LeadershipMemberDto | null;

  @ApiProperty({ type: [LeadershipMemberDto] })
  declare deputies: LeadershipMemberDto[];

  @ApiProperty({ type: [LeadershipMemberDto] })
  declare secretaries: LeadershipMemberDto[];

  @ApiProperty({ type: [LeadershipMemberDto] })
  declare others: LeadershipMemberDto[];
}
