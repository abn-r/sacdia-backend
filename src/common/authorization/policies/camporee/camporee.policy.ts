import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import type {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from '../scope/territory-scope';

export class CamporeePolicy implements ResourcePolicy<'camporee'> {
  readonly type = 'camporee' as const;

  constructor(
    private readonly territory: TerritoryScopeValidator,
    private readonly loader: CamporeeScopeLoader,
  ) {}

  async resolve({ request, resolved, resource }: PolicyContext) {
    const camporeeId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'camporeeId'),
      'Camporee ID not found in request',
    );

    return this.territory.validateTerritoryScope(
      resolved,
      await this.loader.loadCamporeeScope(camporeeId),
    );
  }
}
