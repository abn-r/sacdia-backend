import {
  Controller,
  Get,
  Patch,
  Put,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateUserAllergiesDto,
  UpdateUserDiseasesDto,
  UpdateUserMedicinesDto,
} from './dto/update-user-medical.dto';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userId')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Obtener información de un usuario' })
  @ApiResponse({ status: 200, description: 'Usuario encontrado' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async findOne(@Param('userId') userId: string) {
    return this.usersService.findOne(userId);
  }

  @Get(':userId/allergies')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Obtener alergias activas del usuario' })
  @ApiResponse({ status: 200, description: 'Alergias obtenidas' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async getAllergies(@Param('userId') userId: string) {
    return this.usersService.getAllergies(userId);
  }

  @Get(':userId/diseases')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Obtener enfermedades activas del usuario' })
  @ApiResponse({ status: 200, description: 'Enfermedades obtenidas' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async getDiseases(@Param('userId') userId: string) {
    return this.usersService.getDiseases(userId);
  }

  @Get(':userId/medicines')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Obtener medicamentos activos del usuario' })
  @ApiResponse({ status: 200, description: 'Medicamentos obtenidos' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async getMedicines(@Param('userId') userId: string) {
    return this.usersService.getMedicines(userId);
  }

  @Patch(':userId')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Actualizar información personal del usuario' })
  @ApiResponse({ status: 200, description: 'Usuario actualizado' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async update(
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(userId, updateUserDto);
  }

  @Put(':userId/allergies')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Guardar alergias del usuario',
    description:
      'Reemplaza el conjunto de alergias activas del usuario en users_allergies',
  })
  @ApiResponse({ status: 200, description: 'Alergias actualizadas' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({ status: 400, description: 'Alergia inválida' })
  async updateAllergies(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserAllergiesDto,
  ) {
    return this.usersService.updateAllergies(userId, dto);
  }

  @Put(':userId/diseases')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Guardar enfermedades del usuario',
    description:
      'Reemplaza el conjunto de enfermedades activas del usuario en users_diseases',
  })
  @ApiResponse({ status: 200, description: 'Enfermedades actualizadas' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({ status: 400, description: 'Enfermedad inválida' })
  async updateDiseases(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDiseasesDto,
  ) {
    return this.usersService.updateDiseases(userId, dto);
  }

  @Put(':userId/medicines')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Guardar medicamentos del usuario',
    description:
      'Reemplaza el conjunto de medicamentos activos del usuario en users_medicines',
  })
  @ApiResponse({ status: 200, description: 'Medicamentos actualizados' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({ status: 400, description: 'Medicamento inválido' })
  async updateMedicines(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserMedicinesDto,
  ) {
    return this.usersService.updateMedicines(userId, dto);
  }

  @Delete(':userId/allergies/:allergyId')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Eliminar alergia del usuario (borrado lógico)',
    description:
      'Desactiva (active=false) una alergia específica del usuario en users_allergies',
  })
  @ApiResponse({ status: 200, description: 'Alergia eliminada' })
  @ApiResponse({
    status: 404,
    description: 'Alergia no encontrada en el usuario',
  })
  async removeAllergy(
    @Param('userId') userId: string,
    @Param('allergyId', ParseIntPipe) allergyId: number,
  ) {
    return this.usersService.removeAllergy(userId, allergyId);
  }

  @Delete(':userId/diseases/:diseaseId')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Eliminar enfermedad del usuario (borrado lógico)',
    description:
      'Desactiva (active=false) una enfermedad específica del usuario en users_diseases',
  })
  @ApiResponse({ status: 200, description: 'Enfermedad eliminada' })
  @ApiResponse({
    status: 404,
    description: 'Enfermedad no encontrada en el usuario',
  })
  async removeDisease(
    @Param('userId') userId: string,
    @Param('diseaseId', ParseIntPipe) diseaseId: number,
  ) {
    return this.usersService.removeDisease(userId, diseaseId);
  }

  @Delete(':userId/medicines/:medicineId')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Eliminar medicamento del usuario (borrado lógico)',
    description:
      'Desactiva (active=false) un medicamento específico del usuario en users_medicines',
  })
  @ApiResponse({ status: 200, description: 'Medicamento eliminado' })
  @ApiResponse({
    status: 404,
    description: 'Medicamento no encontrado en el usuario',
  })
  async removeMedicine(
    @Param('userId') userId: string,
    @Param('medicineId', ParseIntPipe) medicineId: number,
  ) {
    return this.usersService.removeMedicine(userId, medicineId);
  }

  @Post(':userId/profile-picture')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir foto de perfil' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Foto subida exitosamente' })
  @ApiResponse({ status: 400, description: 'Formato o tamaño inválido' })
  async uploadProfilePicture(
    @Param('userId') userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.usersService.uploadProfilePicture(userId, file);
  }

  @Delete(':userId/profile-picture')
  @RequirePermissions('users:update')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Eliminar foto de perfil' })
  @ApiResponse({ status: 200, description: 'Foto eliminada' })
  @ApiResponse({ status: 404, description: 'Usuario sin foto de perfil' })
  async deleteProfilePicture(@Param('userId') userId: string) {
    return this.usersService.deleteProfilePicture(userId);
  }

  @Get(':userId/age')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({ summary: 'Calcular edad del usuario' })
  @ApiResponse({ status: 200, description: 'Edad calculada' })
  async getAge(@Param('userId') userId: string) {
    const age = await this.usersService.calculateAge(userId);
    return {
      status: 'success',
      data: { age },
    };
  }

  @Get(':userId/requires-legal-representative')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Verificar si el usuario requiere representante legal',
  })
  @ApiResponse({
    status: 200,
    description: 'Si requiere (edad < 18) o no',
  })
  async requiresLegalRepresentative(@Param('userId') userId: string) {
    const age = await this.usersService.calculateAge(userId);
    const required =
      await this.usersService.requiresLegalRepresentative(userId);

    return {
      status: 'success',
      data: {
        required,
        userAge: age,
        reason: required
          ? 'Usuario es menor de 18 años'
          : 'Usuario es mayor de edad',
      },
    };
  }
}
