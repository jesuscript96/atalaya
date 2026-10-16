export function Marca({ claro = false }: { claro?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-display font-bold text-[1.25rem]" style={{ color: claro ? "#fff" : undefined }}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill={claro ? "#22313b" : "#14202a"} />
        <path d="M16 5 L26 25 H6 Z" fill="none" stroke="#f2b705" strokeWidth="3" strokeLinejoin="round" />
        <path d="M11 19 H21" stroke="#fff" strokeWidth="2.4" />
      </svg>
      Atalaya
    </span>
  );
}
