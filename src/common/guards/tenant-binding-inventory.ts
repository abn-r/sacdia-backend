import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Static inventory of routes whose resource type does not resolve a tenant
 * by itself (`global`, `user`, `active_assignment`) but whose path carries a
 * tenant identifier. Used by tenant-binding-inventory.spec.ts to keep new
 * routes from shipping without `bind`.
 *
 * Source-text scan on purpose: importing every controller would pull the
 * whole module graph into the test.
 *
 * Tenant ids carried in the request body or query string are detected too:
 * inline `@Body('club_id')` / `@Query('clubId')` and the properties of the DTO
 * classes behind `@Body() dto: Dto` / `@Query() q: Dto` (resolved by indexing
 * the DTO sources, following PartialType/OmitType/PickType/IntersectionType
 * and plain `extends`). A route is flagged when such a field is not covered by
 * a `bind` entry with the same `field`.
 */

export const UNBOUND_RESOURCE_TYPES = new Set([
  'global',
  'user',
  'active_assignment',
]);

export const TENANT_PATH_PARAM =
  /:(clubId|sectionId|clubSectionId|instanceId|localFieldId|fieldId|unionId|divisionId|camporeeId|unionCamporeeId|localCamporeeId)\b/;

export const TENANT_FIELD_NAMES =
  /^(club_id|club_section_id|local_field_id|union_id|division_id|camporee_id|union_camporee_id|local_camporee_id|clubId|localFieldId|unionId|divisionId)$/;

export type InventoriedRoute = {
  key: string;
  resourceType: string | null;
  hasBind: boolean;
  hasTenantParam: boolean;
  /** Tenant-named fields carried in the body or query (inline or via DTO). */
  bodyTenantFields: string[];
  /** `field` values of the `bind` entries of the resolved resource. */
  boundFields: string[];
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
  boundFields: string[];
} {
  if (!resourceCall) {
    return { resourceType: null, hasBind: false, boundFields: [] };
  }
  const bindStart = resourceCall.search(/\bbind:\s*\[/);
  const bindText = bindStart === -1 ? '' : resourceCall.slice(bindStart);
  return {
    resourceType: /type:\s*'(\w+)'/.exec(resourceCall)?.[1] ?? null,
    hasBind: bindStart !== -1,
    boundFields: [...bindText.matchAll(/\bfield:\s*'(\w+)'/g)].map((m) => m[1]),
  };
}

type DtoDefinition = { props: string[]; heritage: string };

function listDtoFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listDtoFiles(fullPath);
    }
    const isDto =
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      (entry.name.endsWith('.dto.ts') || fullPath.split(sep).includes('dto'));
    return isDto ? [fullPath] : [];
  });
}

function indexDtoClasses(srcRoot: string): Map<string, DtoDefinition> {
  const index = new Map<string, DtoDefinition>();
  for (const file of listDtoFiles(srcRoot)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let current: { name: string; def: DtoDefinition } | null = null;
    let heritage = '';
    let headerOpen = false;
    for (const line of lines) {
      const start = /^export (?:abstract )?class (\w+)/.exec(line);
      if (start) {
        current = { name: start[1], def: { props: [], heritage: '' } };
        heritage = line;
        headerOpen = !line.includes('{');
        if (!headerOpen) {
          current.def.heritage = heritage;
          index.set(current.name, current.def);
        }
        continue;
      }
      if (current && headerOpen) {
        heritage += ' ' + line.trim();
        if (line.includes('{')) {
          headerOpen = false;
          current.def.heritage = heritage;
          index.set(current.name, current.def);
        }
        continue;
      }
      if (!current) {
        continue;
      }
      if (line === '}') {
        current = null;
        continue;
      }
      const prop = /^ {2}(?:readonly\s+)?(\w+)[?!]?\s*[:=]/.exec(line);
      if (prop) {
        current.def.props.push(prop[1]);
      }
    }
  }
  return index;
}

function quotedList(text: string): string[] {
  return [...text.matchAll(/['"](\w+)['"]/g)].map((m) => m[1]);
}

function resolveDtoProps(
  name: string,
  index: Map<string, DtoDefinition>,
  seen: Set<string> = new Set(),
): string[] {
  const def = index.get(name);
  if (!def || seen.has(name)) {
    return [];
  }
  seen.add(name);
  const own = [...def.props];
  const extendsClause = /\bextends\s+([\s\S]*?)\s*(?:implements\b|\{)/.exec(
    def.heritage,
  )?.[1];
  if (!extendsClause) {
    return own;
  }
  const mapped =
    /^(PartialType|OmitType|PickType|IntersectionType|OmitType)\s*\(\s*(\w+)(?:\s*,\s*([\s\S]*))?\)\s*$/.exec(
      extendsClause,
    );
  if (!mapped) {
    const base = /^(\w+)/.exec(extendsClause)?.[1];
    return base ? [...own, ...resolveDtoProps(base, index, seen)] : own;
  }
  const [, helper, baseName, rest = ''] = mapped;
  let inherited = resolveDtoProps(baseName, index, seen);
  if (helper === 'OmitType') {
    const omitted = new Set(quotedList(rest));
    inherited = inherited.filter((prop) => !omitted.has(prop));
  } else if (helper === 'PickType') {
    const picked = new Set(quotedList(rest));
    inherited = inherited.filter((prop) => picked.has(prop));
  } else if (helper === 'IntersectionType') {
    const second = /^\s*(\w+)/.exec(rest)?.[1];
    if (second) {
      inherited = [...inherited, ...resolveDtoProps(second, index, seen)];
    }
  }
  return [...own, ...inherited];
}

/** Tenant-named fields a handler reads from its body or query. */
function collectBodyTenantFields(
  paramsText: string,
  dtoIndex: Map<string, DtoDefinition>,
): string[] {
  const fields = new Set<string>();
  const decorator = /@(Body|Query)\(/g;
  let match: RegExpExecArray | null;
  while ((match = decorator.exec(paramsText)) !== null) {
    const call = extractCall(paramsText.slice(match.index), `@${match[1]}(`);
    if (!call) {
      continue;
    }
    const inline = /^@\w+\(\s*['"](\w+)['"]/.exec(call)?.[1];
    if (inline) {
      if (TENANT_FIELD_NAMES.test(inline)) {
        fields.add(inline);
      }
      continue;
    }
    const after = paramsText.slice(match.index + call.length);
    const dtoName = /^\s*(?:readonly\s+)?\w+\??\s*:\s*([A-Za-z_]\w*)/.exec(
      after,
    )?.[1];
    if (dtoName) {
      for (const prop of resolveDtoProps(dtoName, dtoIndex)) {
        if (TENANT_FIELD_NAMES.test(prop)) {
          fields.add(prop);
        }
      }
    }
  }
  return [...fields].sort();
}

/** Parameter list text starting at the method signature line. */
function readParams(lines: string[], signatureIndex: number): string {
  const chunk: string[] = [];
  for (let i = signatureIndex; i < lines.length; i++) {
    chunk.push(lines[i]);
    if (i > signatureIndex && /^ {2}\)/.test(lines[i])) {
      break;
    }
    if (i === signatureIndex && /\)\s*(?::[^{]*)?\{\s*$/.test(lines[i])) {
      break;
    }
  }
  return chunk.join('\n');
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
  const dtoIndex = indexDtoClasses(srcRoot);

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

      for (const [lineIndex, line] of lines.entries()) {
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
          bodyTenantFields: collectBodyTenantFields(
            readParams(lines, lineIndex),
            dtoIndex,
          ),
          boundFields: resource.boundFields,
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

/**
 * Unbound-type routes that read a tenant id from the body/query that no `bind`
 * entry of the same `field` covers.
 */
export function findUnboundBodyTenantRoutes(
  routes: InventoriedRoute[],
): string[] {
  return routes
    .filter(
      (route) =>
        route.resourceType !== null &&
        UNBOUND_RESOURCE_TYPES.has(route.resourceType) &&
        route.bodyTenantFields.some(
          (field) => !route.boundFields.includes(field),
        ),
    )
    .map((route) => route.key);
}
