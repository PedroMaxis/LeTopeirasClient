import type { z } from 'zod';
import { badRequest } from './errors';

/** Parses `value` with `schema`, throwing a 400 AppError with the first issue on failure. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw badRequest(`${path}${issue?.message ?? 'Dados inválidos'}`, 'validation_error');
}
