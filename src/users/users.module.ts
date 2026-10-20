import { Module } from '@nestjs/common';
import { ActingForModule } from '../auth/acting-for/acting-for.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [ActingForModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // Para usar en otros módulos
})
export class UsersModule {}
