import { useState, type FormEvent, type ReactNode } from 'react';
import { LIMITS, type AuthResponse } from '@letopeiras/shared';
import { errorMessage, login, register } from '../lib/api';
import { FieldLabel } from './ui/controls';
import { Logo } from './ui/Logo';

interface Props {
  notice: string | null;
  onAuthenticated(auth: AuthResponse, remember: boolean): void;
}

export function AuthScreen({ notice, onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  return (
    <div className="auth soil">
      {mode === 'login' ? (
        <LoginForm
          notice={notice}
          onAuthenticated={onAuthenticated}
          onSwitch={() => setMode('register')}
        />
      ) : (
        <RegisterForm onAuthenticated={onAuthenticated} onSwitch={() => setMode('login')} />
      )}
    </div>
  );
}

function AuthCard({
  title,
  subtitle,
  children,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onSubmit(e: FormEvent): void;
}) {
  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <div className="auth-header">
        <Logo size={96} />
        <div className="auth-wordmark">LeTopeiras</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </form>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <div className="field">
      <FieldLabel htmlFor={props.id}>
        {props.label} <span className="required">*</span>
      </FieldLabel>
      <input
        id={props.id}
        className="input"
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        spellCheck={false}
        required
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <div className="field-hint">{props.hint}</div>}
    </div>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function LoginForm({
  notice,
  onAuthenticated,
  onSwitch,
}: {
  notice: string | null;
  onAuthenticated: Props['onAuthenticated'];
  onSwitch(): void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const { busy, error, submit } = useSubmit(async () => {
    onAuthenticated(await login({ username, password }), remember);
  });

  return (
    <AuthCard
      title="Bem-vindo de volta esquisto!"
      subtitle="Entra aí caraio"
      onSubmit={(e) => void submit(e)}
    >
      {notice && <div className="form-notice">{notice}</div>}
      <Field
        id="username"
        label="USUÁRIO"
        value={username}
        onChange={setUsername}
        placeholder="seu_usuario"
        autoComplete="username"
        autoFocus
      />
      <Field
        id="password"
        label="SENHA"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder="••••••••"
        autoComplete="current-password"
      />
      <label className="checkbox">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Manter conectado neste PC
      </label>
      {error && <div className="form-error">{error}</div>}
      <button type="submit" className="button primary large" disabled={busy}>
        {busy ? 'Entrando…' : 'Entrar no bagui'}
      </button>
      <div className="auth-switch">
        Tem um código de convite?{' '}
        <button type="button" className="link" onClick={onSwitch}>
          Criar conta
        </button>
      </div>
    </AuthCard>
  );
}

function RegisterForm({
  onAuthenticated,
  onSwitch,
}: {
  onAuthenticated: Props['onAuthenticated'];
  onSwitch(): void;
}) {
  const [inviteCode, setInviteCode] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    onAuthenticated(await register({ inviteCode, username, displayName, password }), true);
  });

  return (
    <AuthCard
      title="Cavar sua toca"
      subtitle="Você precisa de um convite de alguém do grupo."
      onSubmit={(e) => void submit(e)}
    >
      <Field
        id="invite"
        label="CÓDIGO DE CONVITE"
        value={inviteCode}
        onChange={setInviteCode}
        placeholder="ex.: K7Q2M9XAPB"
        hint="O admin gera esse código no app."
        autoFocus
      />
      <div className="field-row">
        <Field
          id="new-username"
          label="USUÁRIO"
          value={username}
          onChange={setUsername}
          placeholder="pedro"
          autoComplete="username"
          maxLength={LIMITS.usernameMax}
          hint="Minúsculas, números, _ e ."
        />
        <Field
          id="display-name"
          label="NOME DE EXIBIÇÃO"
          value={displayName}
          onChange={setDisplayName}
          placeholder="Pedro"
          maxLength={LIMITS.displayNameMax}
        />
      </div>
      <Field
        id="new-password"
        label="SENHA"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder={`mínimo ${LIMITS.passwordMin} caracteres`}
        autoComplete="new-password"
        maxLength={LIMITS.passwordMax}
      />
      {error && <div className="form-error">{error}</div>}
      <button type="submit" className="button primary large" disabled={busy}>
        {busy ? 'Criando…' : 'Criar conta'}
      </button>
      <div className="auth-switch">
        <button type="button" className="link" onClick={onSwitch}>
          Já tem uma conta ne?
        </button>
      </div>
    </AuthCard>
  );
}
