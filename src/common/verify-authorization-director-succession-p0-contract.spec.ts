import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as preflightScript from '../../scripts/verify-authorization-director-succession-p0';
import {
  createTestConsumerRoots,
  type TestConsumerRoots,
} from './testing/authorization-p0-consumer-roots.fixture';

const root = join(__dirname, '../..');
type Inventory = {
  known_internal_consumers: readonly string[];
  active_jsx_consumers: string[];
  flutter_consumers: string[];
};
let fixture: TestConsumerRoots;
beforeEach(() => {
  fixture = createTestConsumerRoots(preflightScript.CONSUMER_INVENTORY);
});
afterEach(() => fixture.dispose());

describe('authorization P0 operational contract', () => {
  it('fails closed without required roots and accepts the exact fixture', () => {
    const inspect = preflightScript.inspectConsumerInventory as (roots: {
      workspaceRoot: string;
      docsRoot: string;
    }) => Inventory;
    expect(() =>
      inspect({
        workspaceRoot: join(root, 'missing-workspace'),
        docsRoot: join(root, 'missing-docs'),
      }),
    ).toThrow('CONSUMER_INVENTORY_UNAVAILABLE');
    const inventory = inspect({
      workspaceRoot: fixture.workspaceRoot,
      docsRoot: fixture.docsRoot,
    });
    expect(inventory.known_internal_consumers).toEqual(
      preflightScript.CONSUMER_INVENTORY,
    );
    expect(inventory.active_jsx_consumers).toEqual([]);
    expect(inventory.flutter_consumers).toEqual([]);
  });

  it('fails closed when a discovered Dart consumer is not inventoried', () => {
    const dart = join(
      fixture.appRoot,
      'lib/features/auth/director_succession.dart',
    );
    mkdirSync(dirname(dart), { recursive: true });
    writeFileSync(dart, 'can_schedule_director_succession\n');
    let inventory: Inventory | undefined;
    let diagnostic: string | undefined;
    try {
      inventory = preflightScript.inspectConsumerInventory({
        workspaceRoot: fixture.workspaceRoot,
        docsRoot: fixture.docsRoot,
      });
    } catch (error) {
      diagnostic = (error as Error).message;
    }
    expect({
      diagnostic,
      flutter_consumers: inventory?.flutter_consumers,
    }).toEqual({
      diagnostic: 'CONSUMER_INVENTORY_DRIFT',
      flutter_consumers: undefined,
    });
  });

  it('documents exits, limits, timezone contract and best-effort cleanup', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    for (const text of [
      'REPEATABLE READ READ ONLY',
      'Node 24/ICU',
      '10 000 ms',
      '`0` — `clean`',
      '`1` — `blocked`',
      '`130` — `SIGINT`',
      '`143` — `SIGTERM`',
      'MISSING_DATABASE_URL',
      'America/Argentina/Buenos_Aires',
      'promete un `ROLLBACK` explícito',
      'SACDIA_WORKSPACE_ROOT',
      'SACDIA_CANONICAL_DOCS_ROOT',
      'CONSUMER_INVENTORY_UNAVAILABLE',
    ])
      expect(readme).toContain(text);
  });
});
