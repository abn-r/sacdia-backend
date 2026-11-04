import { getRequestValue, getRequiredNumericValue } from '../request-values';
import type { PolicyContext, ResourcePolicy } from '../resource-policy';
import type {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from '../scope/territory-scope';

export class UnionCamporeePolicy implements ResourcePolicy<'union_camporee'> {
  readonly type = 'union_camporee' as const;

  constructor(
    private readonly territory: TerritoryScopeValidator,
    private readonly loader: CamporeeScopeLoader,
  ) {}

  async resolve({ request, resolved, resource }: PolicyContext) {
    const camporeeId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'unionCamporeeId'),
      'Union camporee ID not found in request',
    );

    return this.territory.validateUnionCamporeeScope(
      resolved,
      await this.loader.loadUnionCamporeeScope(camporeeId),
    );
  }
}
