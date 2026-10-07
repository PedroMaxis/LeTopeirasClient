import {
  apiErrorSchema,
  type AuthResponse,
  type Category,
  type Channel,
  type ChangePasswordRequest,
  type CreateCategoryRequest,
  type CreateChannelRequest,
  type CreateInviteRequest,
  type CreateRoleRequest,
  type InviteResponse,
  type LoginRequest,
  type MessageHistoryResponse,
  type RegisterRequest,
  type Role,
  type UpdateCategoryRequest,
  type UpdateChannelRequest,
  type UpdateProfileRequest,
  type UpdateRoleRequest,
  type User,
  type VoiceTokenResponse,
} from '@letopeiras/shared';

/** Base URL of our server. Set VITE_SERVER_URL in apps/client/.env to override. */
export const SERVER_URL: string =
  import.meta.env['VITE_SERVER_URL'] ??
  (import.meta.env.DEV ? 'http://127.0.0.1:3000' : 'https://letopeiras.duckdns.org');

export const GATEWAY_URL = `${SERVER_URL.replace(/^http/, 'ws')}/ws`;

/** An error from the server (with its stable code) or a network failure (`network`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { token?: string | undefined; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Não foi possível falar com o servidor. Ele está no ar?');
  }

  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(res.status, 'unknown', `Erro inesperado do servidor (${res.status})`);
  }
  return json as T;
}

export const login = (body: LoginRequest) => request<AuthResponse>('POST', '/auth/login', { body });

export const register = (body: RegisterRequest) =>
  request<AuthResponse>('POST', '/auth/register', { body });

/** REST calls that need a session. `onUnauthorized` fires when the token stops working. */
export class Api {
  constructor(
    private readonly token: string,
    private readonly onUnauthorized: () => void,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await request<T>(method, path, { token: this.token, body });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.onUnauthorized();
      throw err;
    }
  }

  logout = () => this.call<undefined>('POST', '/auth/logout');

  messages = (channelId: number, before?: number) =>
    this.call<MessageHistoryResponse>(
      'GET',
      `/channels/${channelId}/messages${before ? `?before=${before}` : ''}`,
    );

  voiceToken = (channelId: number) =>
    this.call<VoiceTokenResponse>('POST', '/voice/token', { channelId });

  createChannel = (body: CreateChannelRequest) => this.call<Channel>('POST', '/channels', body);

  updateChannel = (id: number, body: UpdateChannelRequest) =>
    this.call<Channel>('PATCH', `/channels/${id}`, body);

  deleteChannel = (id: number) => this.call<undefined>('DELETE', `/channels/${id}`);

  createCategory = (body: CreateCategoryRequest) =>
    this.call<Category>('POST', '/categories', body);

  updateCategory = (id: number, body: UpdateCategoryRequest) =>
    this.call<Category>('PATCH', `/categories/${id}`, body);

  deleteCategory = (id: number) => this.call<undefined>('DELETE', `/categories/${id}`);

  createRole = (body: CreateRoleRequest) => this.call<Role>('POST', '/roles', body);

  updateRole = (id: number, body: UpdateRoleRequest) =>
    this.call<Role>('PATCH', `/roles/${id}`, body);

  deleteRole = (id: number) => this.call<undefined>('DELETE', `/roles/${id}`);

  setUserRoles = (userId: number, roleIds: number[]) =>
    this.call<User>('PUT', `/users/${userId}/roles`, { roleIds });

  updateProfile = (body: UpdateProfileRequest) => this.call<User>('PATCH', '/users/me', body);

  changePassword = (body: ChangePasswordRequest) =>
    this.call<undefined>('POST', '/users/me/password', body);

  createInvite = (body: CreateInviteRequest) => this.call<InviteResponse>('POST', '/invites', body);
}

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
