import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Static inventory of routes whose resource type does not resolve a tenant
 * by itself (`global`, `user`, `active_assignment`) but whose path carries a
 * tenant identifier. Used by tenant-binding-inventory.spec.ts to keep new
 * routes from shipping without `bind`.
 *
 * Source-text scan on purpose: importing every controller would pull the
 * whole module graph into the test. Body/query tenant fields are not
 * detectable statically and stay a review concern.
 */

export const UNBOUND_RESOURCE_TYPES = new Set([
  'global',
  'user',
  'active_assignment',
]);

export const TENANT_PATH_PARAM =
  /:(clubId|sectionId|clubSectionId|instanceId|localFieldId|unionId|divisionId|camporeeId|unionCamporeeId|localCamporeeId)\b/;

export type InventoriedRoute = {
  key: string;
  resourceType: string | null;
  hasBind: boolean;
  hasTenantParam: boolean;
};

const ROUTE_DECORATOR =
  /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?/;
const METHOD_SIGNATURE = /^ {2}(?:async\s+)?[A-Za-z_]\w*\s*\(/;

function listControllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listControllerFiles(fullPath);
    }
    return entry.name.endsWith('.controller.ts') ? [fullPath] : [];
  });
}

function extractCall(text: string, marker: string): string | null {
  const start = text.indexOf(marker);
  if (start === -1) {
    return null;
  }
  let depth = 0;
  for (let index = start + marker.length - 1; index < text.length; index++) {
    const char = text[index];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

function describeResource(resourceCall: string | null): {
  resourceType: string | null;
  hasBind: boolean;
} {
  if (!resourceCall) {
    return { resourceType: null, hasBind: false };
  }
  return {
    resourceType: /type:\s*'(\w+)'/.exec(resourceCall)?.[1] ?? null,
    hasBind: /\bbind:\s*\[/.test(resourceCall),
  };
}

function joinPath(prefix: string, path: string): string {
  return (
    '/' +
    [prefix, path]
      .map((part) => part.replace(/^\/+|\/+$/g, ''))
      .filter((part) => part.length > 0)
      .join('/')
  );
}

export function scanControllers(srcRoot: string): InventoriedRoute[] {
  const routes: InventoriedRoute[] = [];

  for (const file of listControllerFiles(srcRoot)) {
    const source = readFileSync(file, 'utf8');
    const relativeFile = relative(srcRoot, file);

    // One file may declare several controllers; scan each class separately.
    const sourceLines = source.split('\n');
    const classStarts = sourceLines
      .map((line, index) => (line.startsWith('export class ') ? index : -1))
      .filter((index) => index !== -1);

    classStarts.forEach((classStart, classIndex) => {
      const header = readClassDecorators(sourceLines, classStart);
      if (!header.includes('@Controller(')) {
        return;
      }
      const prefix = /@Controller\(\s*'([^']*)'/.exec(header)?.[1] ?? '';
      const classResource = describeResource(
        extractCall(header, '@AuthorizationResource('),
      );

      const lines = sourceLines.slice(
        classStart,
        classStarts[classIndex + 1] ?? sourceLines.length,
      );
      let block: string[] = [];

      for (const line of lines) {
        if (line === '  }' || line.startsWith('export class ')) {
          block = [];
          continue;
        }
        if (!METHOD_SIGNATURE.test(line) || line.trimStart().startsWith('@')) {
          block.push(line);
          continue;
        }

        const blockText = block.join('\n');
        block = [];
        const route = ROUTE_DECORATOR.exec(blockText);
        if (!route) {
          continue;
        }

        const methodResource = describeResource(
          extractCall(blockText, '@AuthorizationResource('),
        );
        const resource = methodResource.resourceType
          ? methodResource
          : classResource;
        const path = joinPath(prefix, route[2] ?? route[3] ?? route[4] ?? '');

        routes.push({
          key: `${relativeFile} ${route[1].toUpperCase()} ${path}`,
          resourceType: resource.resourceType,
          hasBind: resource.hasBind,
          hasTenantParam: TENANT_PATH_PARAM.test(path),
        });
      }
    });
  }

  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

/** Contiguous decorator lines right above `export class`. */
function readClassDecorators(lines: string[], classStart: number): string {
  let start = classStart;
  while (start > 0) {
    const previous = lines[start - 1];
    const trimmed = previous.trim();
    if (trimmed.startsWith('//')) {
      start--;
      continue;
    }
    if (
      trimmed === '' ||
      previous === '}' ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      /^(import|export|const|let|type|function)\b/.test(previous)
    ) {
      break;
    }
    start--;
  }
  return lines.slice(start, classStart).join('\n');
}

export function findUnboundTenantRoutes(routes: InventoriedRoute[]): string[] {
  return routes
    .filter(
      (route) =>
        route.resourceType !== null &&
        UNBOUND_RESOURCE_TYPES.has(route.resourceType) &&
        route.hasTenantParam &&
        !route.hasBind,
    )
    .map((route) => route.key);
}
