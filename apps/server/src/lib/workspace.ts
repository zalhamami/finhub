import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { schema, type Db } from '@finhub/db';
import { z } from 'zod';
import { ApiError } from './errors';
import type { AppEnv } from './http';

export interface WorkspaceOptions {
  defaultWorkspaceId?: string;
  defaultWorkspaceSlug?: string;
}

/**
 * Single-user dev-mode tenancy. Sets c.var.workspaceId from, in order:
 *   1. `X-Workspace-Id` header
 *   2. DEFAULT_WORKSPACE_ID (env)
 *   3. the workspace with slug DEFAULT_WORKSPACE_SLUG (default "demo", created by the seed)
 *
 * TODO(auth): this trusts the client. Before exposing the API beyond localhost, replace it
 * with real authentication (session/token -> user -> workspace_members) and derive the
 * workspace from the authenticated membership; the header must then be ignored or checked
 * against membership. Every route already reads only c.var.workspaceId and filters by it.
 */
export function workspaceMiddleware(db: Db, opts: WorkspaceOptions = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('db', db);
    const header = c.req.header('x-workspace-id');
    let where;
    if (header !== undefined) {
      if (!z.guid().safeParse(header).success) {
        throw new ApiError(400, 'invalid_workspace_id', 'X-Workspace-Id must be a UUID');
      }
      where = eq(schema.workspaces.id, header);
    } else if (opts.defaultWorkspaceId) {
      where = eq(schema.workspaces.id, opts.defaultWorkspaceId);
    } else {
      where = eq(schema.workspaces.slug, opts.defaultWorkspaceSlug ?? 'demo');
    }
    const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(where);
    if (!ws) throw new ApiError(404, 'workspace_not_found', 'Workspace not found');
    c.set('workspaceId', ws.id);
    await next();
  });
}
