import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { EmergencyContactsService } from './emergency-contacts.service';
import { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';
import { SensitiveUserSubresource } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('emergency-contacts')
@Controller('users/:userId/emergency-contacts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class EmergencyContactsController {
  constructor(
    private readonly emergencyContactsService: EmergencyContactsService,
  ) {}

  @Post()
  @SensitiveUserSubresource('emergency_contacts', 'update')
  @ApiOperation({ summary: 'Crear contacto de emergencia (máximo 5)' })
  @ApiResponse({ status: 201, description: 'Contacto creado' })
  @ApiResponse({ status: 400, description: 'Máximo de contactos alcanzado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin access only' })
  async create(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() createDto: CreateEmergencyContactDto,
  ) {
    return this.emergencyContactsService.create(userId, createDto);
  }

  @Get()
  @SensitiveUserSubresource('emergency_contacts', 'read')
  @ApiOperation({ summary: 'Listar contactos de emergencia del usuario' })
  @ApiResponse({ status: 200, description: 'Lista de contactos' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin access only' })
  async findAll(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.emergencyContactsService.findAll(userId);
  }

  @Get(':contactId')
  @SensitiveUserSubresource('emergency_contacts', 'read')
  @ApiOperation({ summary: 'Obtener un contacto específico' })
  @ApiResponse({ status: 200, description: 'Contacto encontrado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin access only' })
  @ApiResponse({ status: 404, description: 'Contacto no encontrado' })
  async findOne(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    return this.emergencyContactsService.findOne(contactId, userId);
  }

  @Patch(':contactId')
  @SensitiveUserSubresource('emergency_contacts', 'update')
  @ApiOperation({ summary: 'Actualizar contacto de emergencia' })
  @ApiResponse({ status: 200, description: 'Contacto actualizado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin access only' })
  @ApiResponse({ status: 404, description: 'Contacto no encontrado' })
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('contactId', ParseIntPipe) contactId: number,
    @Body() updateDto: UpdateEmergencyContactDto,
  ) {
    return this.emergencyContactsService.update(contactId, userId, updateDto);
  }

  @Delete(':contactId')
  @SensitiveUserSubresource('emergency_contacts', 'update')
  @ApiOperation({ summary: 'Eliminar contacto de emergencia (soft delete)' })
  @ApiResponse({ status: 200, description: 'Contacto eliminado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin access only' })
  @ApiResponse({ status: 404, description: 'Contacto no encontrado' })
  async remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    return this.emergencyContactsService.remove(contactId, userId);
  }
}
