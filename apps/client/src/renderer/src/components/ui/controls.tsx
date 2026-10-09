import type { MouseEvent, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick(event: MouseEvent<HTMLButtonElement>): void;
  size?: number;
  active?: boolean;
  danger?: boolean;
  className?: string;
  disabled?: boolean;
}

export function IconButton({
  icon,
  label,
  onClick,
  size = 20,
  active = false,
  danger = false,
  className = '',
  disabled = false,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${danger ? 'danger' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

interface ToggleRowProps extends ToggleProps {
  description: ReactNode;
}

export function ToggleRow({ description, ...toggle }: ToggleRowProps) {
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-row-title">{toggle.label}</div>
        <div className="toggle-row-description">{description}</div>
      </div>
      <Toggle {...toggle} />
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly { value: NoInfer<T>; label: string }[];
  onChange(value: NoInfer<T>): void;
}

export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={option.value === value}
          key={option.value}
          className={option.value === value ? 'selected' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}
