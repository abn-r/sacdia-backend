import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { InventoryService } from './inventory.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  ALLOWED_MIME_TYPES,
  FileValidationPipe,
} from '../common/pipes/file-validation.pipe';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ========================================
  // INVENTORY ITEMS
  // ========================================

  @Get('clubs/:clubId/inventory')
  @RequirePermissions('inventory:read')
  @AuthorizationResource({
    type: 'inventory_instance',
    idParam: 'clubId',
    instanceTypeSource: 'query',
    instanceTypeField: 'instanceType',
  })
  @ApiOperation({
    summary: 'Listar items del inventario de un club',
    description:
      'Obtiene todos los items de inventario de una instancia específica de club (Aventureros, Conquistadores, o Guías Mayores)',
  })
  @ApiParam({
    name: 'clubId',
    description: 'ID de la instancia del club',
    example: 5,
  })
  @ApiQuery({
    name: 'instanceType',
    description:
      'Tipo de instancia del club (adv: Aventureros, pathf: Conquistadores, mg: Guías Mayores)',
    example: 'pathf',
    required: true,
  })
  @ApiQuery({
    name: 'category',
    description: 'Filtrar por ID de categoría',
    example: 1,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de items del inventario con metadata',
  })
  @ApiResponse({ status: 400, description: 'Tipo de instancia inválido' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async findAllByClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query('instanceType') instanceType: 'adv' | 'pathf' | 'mg',
    @Query('category', new ParseIntPipe({ optional: true }))
    categoryId?: number,
    @Req() req?: any,
  ) {
    // PermissionsGuard sets req.authorization after resolving the user profile.
    // For regular club members, effective.scope.club holds their active section.
    // For admins / club-managers (canManageClub bypass), scope.club may be null —
    // in that case we pass null so the service falls back to the broad club filter.
    const userSectionId: number | null =
      (req?.authorization?.effective?.scope?.club?.section?.club_section_id as
        | number
        | undefined) ?? null;

    const result = await this.inventoryService.findAllByClub(
      clubId,
      categoryId,
      userSectionId,
    );
    return {
      status: 'success',
      ...result,
    };
  }

  @Get('inventory/:id')
  @RequirePermissions('inventory:read')
  @AuthorizationResource({ type: 'inventory_item', idParam: 'id' })
  @ApiOperation({
    summary: 'Obtener detalles de un item del inventario',
    description:
      'Obtiene información detallada de un item específico incluyendo historial de cambios',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles del item con historial',
  })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.inventoryService.findOne(id);
    return {
      status: 'success',
      data,
    };
  }

  @Get('inventory/:inventoryId/history')
  @RequirePermissions('inventory:read')
  @AuthorizationResource({ type: 'inventory_item', idParam: 'inventoryId' })
  @ApiOperation({
    summary: 'Obtener historial de cambios de un item del inventario',
    description:
      'Retorna el historial de acciones realizadas sobre un item de inventario, ordenado por fecha descendente.',
  })
  @ApiParam({
    name: 'inventoryId',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Historial de cambios del item',
  })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  async getHistory(@Param('inventoryId', ParseIntPipe) inventoryId: number) {
    const data = await this.inventoryService.getInventoryHistory(inventoryId);
    return {
      status: 'success',
      data,
    };
  }

  @Post('clubs/:clubId/inventory')
  @RequirePermissions('inventory:create')
  @AuthorizationResource({
    type: 'inventory_instance',
    idParam: 'clubId',
    instanceTypeSource: 'body',
    instanceTypeField: 'instanceType',
  })
  @ApiOperation({
    summary: 'Agregar nuevo item al inventario',
    description:
      'Crea un nuevo item de inventario para una instancia específica de club. Requiere rol de Director, Deputy Director o Treasurer.',
  })
  @ApiParam({
    name: 'clubId',
    description: 'ID de la instancia del club',
    example: 5,
  })
  @ApiResponse({ status: 201, description: 'Item creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Club o categoría no encontrados' })
  @ApiResponse({
    status: 403,
    description: 'No tiene permisos para agregar items',
  })
  async create(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateItemDto,
    @Req() req: any,
  ) {
    const data = await this.inventoryService.create(clubId, dto, req.user.sub);
    return {
      status: 'success',
      data,
    };
  }

  @Patch('inventory/:id')
  @RequirePermissions('inventory:update')
  @AuthorizationResource({ type: 'inventory_item', idParam: 'id' })
  @ApiOperation({
    summary: 'Actualizar un item del inventario',
    description:
      'Actualiza información de un item existente. Requiere rol de Director, Deputy Director o Treasurer.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Item actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  @ApiResponse({
    status: 403,
    description: 'No tiene permisos para actualizar items',
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateItemDto,
    @Req() req: any,
  ) {
    const data = await this.inventoryService.update(id, dto, req.user.sub);
    return {
      status: 'success',
      data,
    };
  }

  @Post('inventory/:id/evidences')
  @RequirePermissions('inventory:update')
  @AuthorizationResource({ type: 'inventory_item', idParam: 'id' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir foto de evidencia de un item de inventario',
    description:
      'Agrega una foto de evidencia al item. Máximo 3 fotos activas por item.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Foto del artículo (JPEG, PNG o WebP, máximo 5MB)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Evidencia subida exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Archivo inválido o límite excedido',
  })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  async uploadEvidence(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES,
      }),
    )
    file: Express.Multer.File,
    @Req() req: any,
  ) {
    const data = await this.inventoryService.uploadEvidence(
      id,
      req.user.sub,
      file,
    );
    return {
      status: 'success',
      data,
    };
  }

  @Delete('inventory/:id')
  @RequirePermissions('inventory:delete')
  @AuthorizationResource({ type: 'inventory_item', idParam: 'id' })
  @ApiOperation({
    summary: 'Eliminar un item del inventario',
    description:
      'Elimina un item del inventario (soft delete). Requiere rol de Director o Deputy Director.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Item eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  @ApiResponse({
    status: 403,
    description: 'No tiene permisos para eliminar items',
  })
  async delete(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.inventoryService.delete(id, req.user.sub);
    return {
      status: 'success',
      ...data,
    };
  }

  // ========================================
  // INVENTORY CATEGORIES
  // ========================================

  @Get('catalogs/inventory-categories')
  @RequirePermissions('inventory:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Listar categorías de inventario',
    description:
      'Obtiene todas las categorías disponibles para clasificar items de inventario',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorías de inventario',
  })
  async findAllCategories() {
    const data = await this.inventoryService.findAllCategories();
    return {
      status: 'success',
      data,
    };
  }
}
