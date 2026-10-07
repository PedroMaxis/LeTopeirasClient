/** The miner mole (design/logo/brand/logo.svg), drawn inline so it scales crisply. */
export function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo">
      <ellipse cx="18" cy="56" rx="7" ry="4.5" fill="#e9b58c" />
      <ellipse cx="46" cy="56" rx="7" ry="4.5" fill="#e9b58c" />
      <circle cx="32" cy="37" r="20" fill="#6e4a33" />
      <ellipse cx="32" cy="46" rx="11.5" ry="8.5" fill="#b0805d" />
      <circle cx="24.5" cy="35" r="2.2" fill="#1c120b" />
      <circle cx="39.5" cy="35" r="2.2" fill="#1c120b" />
      <ellipse cx="32" cy="41" rx="5" ry="3.6" fill="#f08f8f" />
      <rect x="29.2" y="45" width="2.6" height="4.6" rx="0.8" fill="#fff5ea" />
      <rect x="32.2" y="45" width="2.6" height="4.6" rx="0.8" fill="#fff5ea" />
      <path d="M14 28a18 16.5 0 0 1 36 0z" fill="#f0782a" />
      <rect x="10" y="26" width="44" height="5" rx="2.5" fill="#c95c18" />
      <circle cx="32" cy="19" r="5" fill="#ffe08a" stroke="#1c120b" strokeWidth="2" />
    </svg>
  );
}
