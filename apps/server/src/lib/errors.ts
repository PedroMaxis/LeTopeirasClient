/** An error that is safe to show to the client, with an HTTP status and a stable code. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new AppError(400, code, message);
export const unauthorized = (message = 'Sessão inválida ou expirada') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Você não tem permissão para isso') =>
  new AppError(403, 'forbidden', message);
export const notFound = (message = 'Não encontrado') => new AppError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
export const tooManyRequests = (message = 'Muitas tentativas, espere um pouco') =>
  new AppError(429, 'rate_limited', message);
