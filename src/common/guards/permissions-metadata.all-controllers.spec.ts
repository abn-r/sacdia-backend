import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join } from 'path';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AUTHORIZATION_RESOURCE_KEY } from '../decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_PERMISSIONS_KEY } from '../decorators/skip-permissions.decorator';

/**
 * Repo-wide guard against GUARD_RBAC_MISCONFIGURATION. PermissionsGuard is a
 * global guard: every route must be @Public, @SkipPermissions, or carry BOTH
 * @RequirePermissions and @AuthorizationResource (handler or class level).
 * A route with only one of them 500s for every caller, admins included, and
 * the curated specs in permissions-metadata.spec.ts only cover the
 * controllers someone remembered to list.
 */

const SRC_ROOT = join(__dirname, '..', '..');

function listControllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : listControllerFiles(fullPath);
    }
    return entry.name.endsWith('.controller.ts') ? [fullPath] : [];
  });
}

type Route = { label: string; handler: object; controller: object };

function collectRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of listControllerFiles(SRC_ROOT)) {
    const moduleExports = require(file) as Record<string, unknown>;
    for (const exported of Object.values(moduleExports)) {
      if (
        typeof exported !== 'function' ||
        Reflect.getMetadata('path', exported) === undefined
      ) {
        continue;
      }
      const proto = (exported as { prototype: object }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name];
        if (
          name === 'constructor' ||
          typeof handler !== 'function' ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        ) {
          continue;
        }
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        routes.push({
          label: `${exported.name}.${name} (${String(path)})`,
          handler,
          controller: exported,
        });
      }
    }
  }
  return routes;
}

describe('PermissionsGuard metadata across all controllers', () => {
  const reflector = new Reflector();
  const routes = collectRoutes();

  it('discovers controller routes', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('gives every route permissions and an authorization resource, or an explicit opt-out', () => {
    const misconfigured: string[] = [];

    for (const { label, handler, controller } of routes) {
      const targets = [handler, controller];
      const optedOut =
        reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
        reflector.getAllAndOverride<boolean>(SKIP_PERMISSIONS_KEY, targets);
      if (optedOut) {
        continue;
      }

      const requirement = reflector.getAllAndOverride<{
        permissions?: string[];
      }>(PERMISSIONS_KEY, targets);
      const resource = reflector.getAllAndOverride(
        AUTHORIZATION_RESOURCE_KEY,
        targets,
      );

      if (!requirement?.permissions?.length || !resource) {
        misconfigured.push(
          `${label}: permissions=${Boolean(requirement?.permissions?.length)} resource=${Boolean(resource)}`,
        );
      }
    }

    expect(misconfigured).toEqual([]);
  });
});
