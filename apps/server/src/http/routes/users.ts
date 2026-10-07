import {
  changePasswordRequestSchema,
  createRoleRequestSchema,
  idSchema,
  setUserRolesRequestSchema,
  updateProfileRequestSchema,
  updateRoleRequestSchema,
  type Role,
  type User,
} from '@letopeiras/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { expectRow } from '../../db';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { parse } from '../../lib/validate';
import {
  createRole,
  deleteRole,
  existingRoleIds,
  setUserRoles,
  updateRole,
} from '../../repo/roles';
import { deleteOtherSessions } from '../../repo/sessions';
import {
  findUserById,
  findUserByUsername,
  updateDisplayName,
  updatePasswordHash,
} from '../../repo/users';
import { getAdmin, getAuth, requireAuth, type AppContext } from '../context';
import { applyPermissionChange } from '../permissions';

const idParamsSchema = z.object({ id: z.coerce.number().pipe(idSchema) });

/** Tags (roles), who has them, and the user's own profile. */
export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, gateway } = ctx;
  const preHandler = requireAuth(db);

  // --------------------------------------------------------------------- tags

  app.post('/roles', { preHandler }, async (request, reply): Promise<Role> => {
    getAdmin(request);
    const role = createRole(db, parse(createRoleRequestSchema, request.body));
    gateway.broadcast({ type: 'role.created', data: { role } });
    reply.status(201);
    return role;
  });

  app.patch('/roles/:id', { preHandler }, async (request): Promise<Role> => {
    getAdmin(request);
    const { id } = parse(idParamsSchema, request.params);
    const role = updateRole(db, id, parse(updateRoleRequestSchema, request.body));
    if (!role) throw notFound('Tag não encontrada');
    gateway.broadcast({ type: 'role.updated', data: { role } });
    return role;
  });

  app.delete('/roles/:id', { preHandler }, async (request, reply) => {
    getAdmin(request);
    const { id } = parse(idParamsSchema, request.params);
    if (!deleteRole(db, id)) throw notFound('Tag não encontrada');
    // Members and private channels lose this tag.
    applyPermissionChange(ctx, request.log);
    return reply.status(204).send();
  });

  app.put('/users/:id/roles', { preHandler }, async (request): Promise<User> => {
    getAdmin(request);
    const { id } = parse(idParamsSchema, request.params);
    if (!findUserById(db, id)) throw notFound('Usuário não encontrado');
    const { roleIds } = parse(setUserRolesRequestSchema, request.body);
    setUserRoles(db, id, existingRoleIds(db, roleIds));
    applyPermissionChange(ctx, request.log);
    return expectRow(findUserById(db, id));
  });

  // ------------------------------------------------------------------ profile

  app.patch('/users/me', { preHandler }, async (request): Promise<User> => {
    const { user } = getAuth(request);
    const { displayName } = parse(updateProfileRequestSchema, request.body);
    updateDisplayName(db, user.id, displayName);
    const updated = expectRow(findUserById(db, user.id));
    gateway.refreshUser(updated);
    gateway.broadcast({ type: 'user.updated', data: { user: updated } });
    return updated;
  });

  app.post('/users/me/password', { preHandler }, async (request, reply) => {
    const { user, session } = getAuth(request);
    const { currentPassword, newPassword } = parse(changePasswordRequestSchema, request.body);
    const stored = expectRow(findUserByUsername(db, user.username));
    if (!(await verifyPassword(stored.passwordHash, currentPassword))) {
      throw badRequest('Senha atual incorreta', 'wrong_password');
    }
    updatePasswordHash(db, user.id, await hashPassword(newPassword));
    // Other devices have to log in again with the new password.
    deleteOtherSessions(db, user.id, session.id);
    gateway.closeOtherSessions(user.id, session.id);
    return reply.status(204).send();
  });
}
