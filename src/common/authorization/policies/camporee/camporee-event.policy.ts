import type { PrismaService } from '../../../../prisma/prisma.service';
import { AppNotFoundException } from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import type {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from '../scope/territory-scope';

export class CamporeeEventPolicy implements ResourcePolicy<'camporee_event'> {
  readonly type = 'camporee_event' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly territory: TerritoryScopeValidator,
    private readonly loader: CamporeeScopeLoader,
  ) {}

  async resolve({ request, resolved, resource }: PolicyContext) {
    const eventId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'eventId'),
      'Event ID not found in request',
    );

    const event = await this.prisma.camporee_events.findUnique({
      where: { camporee_event_id: eventId },
      select: {
        local_camporee_id: true,
        union_camporee_id: true,
      },
    });

    if (!event) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_EVENT_NOT_FOUND);
    }

    if (event.local_camporee_id) {
      return this.territory.validateTerritoryScope(
        resolved,
        await this.loader.loadCamporeeScope(event.local_camporee_id),
      );
    }
    // An event belongs to a local or a union camporee; neither id means the
    // row is inconsistent, so it reads as a missing union camporee.
    if (event.union_camporee_id === null) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
      );
    }
    return this.territory.validateUnionCamporeeScope(
      resolved,
      await this.loader.loadUnionCamporeeScope(event.union_camporee_id),
    );
  }
}
