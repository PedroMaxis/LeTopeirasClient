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
  messageHistoryResponseSchema,
  musicSearchResponseSchema,
  searchResponseSchema,
  type MessageHistoryResponse,
  type MusicVideo,
  type SearchQuery,
  type SearchResponse,
  type RegisterRequest,
  type Role,
  type UpdateCategoryRequest,
  type UpdateChannelRequest,
  type UpdateProfileRequest,
  type UpdateRoleRequest,
  type User,
  type VoiceTokenResponse,
  type Attachment,
  uploadResponseSchema,
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
  // FormData sets its own multipart content-type (with the boundary).
  const body = options.body;
  if (body !== undefined && !(body instanceof FormData))
    headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? null : body instanceof FormData ? body : JSON.stringify(body),
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

  /** Uploads one chat image; `onProgress` gets 0–1. XHR because fetch has no upload progress. */
  uploadImage = (file: File, onProgress: (fraction: number) => void): Promise<Attachment> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SERVER_URL}/uploads`);
      xhr.setRequestHeader('authorization', `Bearer ${this.token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      const failed = () => reject(new ApiError(0, 'network', 'Não foi possível enviar a imagem.'));
      xhr.onerror = failed;
      xhr.onabort = failed;
      xhr.ontimeout = failed;
      // Every path settles the promise, even a body that isn't JSON (a proxy's error page),
      // so the tray never stays stuck on "uploading".
      xhr.onload = () => {
        let json: unknown = null;
        try {
          json = JSON.parse(xhr.responseText || 'null');
        } catch {
          // Not JSON: reported as an unexpected answer below.
        }
        if (xhr.status === 201) {
          const uploaded = uploadResponseSchema.safeParse(json);
          if (uploaded.success) return resolve(uploaded.data);
        }
        if (xhr.status === 401) this.onUnauthorized();
        const parsed = apiErrorSchema.safeParse(json);
        reject(
          parsed.success
            ? new ApiError(xhr.status, parsed.data.error.code, parsed.data.error.message)
            : new ApiError(xhr.status, 'unknown', `Erro inesperado do servidor (${xhr.status})`),
        );
      };
      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    });

  setAvatar = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return this.call<User>('PUT', '/users/me/avatar', form);
  };

  removeAvatar = () => this.call<User>('DELETE', '/users/me/avatar');

  logout = () => this.call<undefined>('POST', '/auth/logout');

  // Parsed so message fields added later (reactions, replies) get their defaults.
  messages = async (channelId: number, before?: number): Promise<MessageHistoryResponse> =>
    messageHistoryResponseSchema.parse(
      await this.call('GET', `/channels/${channelId}/messages${before ? `?before=${before}` : ''}`),
    );

  search = async (query: SearchQuery): Promise<SearchResponse> => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return searchResponseSchema.parse(await this.call('GET', `/search?${params}`));
  };

  musicSearch = async (q: string): Promise<MusicVideo[]> =>
    musicSearchResponseSchema.parse(
      await this.call('GET', `/music/search?${new URLSearchParams({ q })}`),
    ).results;

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
