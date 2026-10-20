import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ACTING_SCOPE_KEY } from './acting-scope.decorator';
import type { ActingForScope } from './auth-principal';

/**
 * Test helper shared by the acting-scope metadata snapshot and the teen route
 * walk: discovers every controller route from the real decorators (no Nest
 * bootstrap). Not imported by production code.
 */

export type AnyFn = (...args: never[]) => unknown;

export interface RouteInfo {
  key: string; // "GET /users/:userId"
  method: string;
  fullPath: string;
  controller: AnyFn;
  handler: AnyFn;
  /** What the policy actually enforces: the handler's scope, else the class's. */
  scope: ActingForScope | undefined;
  handlerScope: ActingForScope | undefined;
  classScope: ActingForScope | undefined;
}

export const SRC_ROOT = path.resolve(__dirname, '../..');

function listControllerFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listControllerFiles(full, acc);
    } else if (
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function joinPaths(...parts: string[]): string {
  const joined = '/' + parts.filter((p) => p !== '').join('/');
  const normalized = joined.replace(/\/+/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

export function collectRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const seen = new Set<AnyFn>();
  for (const file of listControllerFiles(SRC_ROOT)) {
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || seen.has(exported)) continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, exported) as
        string | string[] | undefined;
      if (controllerPath === undefined) continue;
      seen.add(exported);
      const bases = Array.isArray(controllerPath)
        ? controllerPath
        : [controllerPath];
      const proto = (exported as { prototype: Record<string, unknown> })
        .prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | string[] | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (methodPath === undefined || method === undefined) continue;
        const methodPaths = Array.isArray(methodPath)
          ? methodPath
          : [methodPath];
        const handlerScope = Reflect.getMetadata(ACTING_SCOPE_KEY, handler) as
          ActingForScope | undefined;
        const classScope = Reflect.getMetadata(ACTING_SCOPE_KEY, exported) as
          ActingForScope | undefined;
        // Same resolution as readActingScope (handler wins over class), so a
        // class-level decorator can never hide from the equality check below.
        const scope = handlerScope ?? classScope;
        for (const base of bases) {
          for (const mp of methodPaths) {
            const fullPath = joinPaths(base, mp);
            const verb = RequestMethod[method];
            routes.push({
              key: `${verb} ${fullPath}`,
              method: verb,
              fullPath,
              controller: exported,
              handler,
              scope,
              handlerScope,
              classScope,
            });
          }
        }
      }
    }
  }
  return routes;
}
