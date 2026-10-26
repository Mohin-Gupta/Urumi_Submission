const paths = {
  servers: <><rect x="2" y="2.5" width="12" height="4" rx="1" /><rect x="2" y="9.5" width="12" height="4" rx="1" /></>,
  chat: <path d="M3 3h10v7H7l-3 3v-3H3z" />,
  keys: <><circle cx="5.5" cy="8" r="2.5" /><path d="M8 8h6M12 8v2" /></>,
  team: <><circle cx="6" cy="6" r="2.5" /><path d="M2 13c.6-2.3 2.2-3.5 4-3.5s3.4 1.2 4 3.5M11 4.5a2 2 0 010 4M12.5 13c-.2-1.4-.8-2.4-1.6-3" /></>,
  audit: <path d="M3 2.5h10M3 6h10M3 9.5h7M3 13h5" />,
  metrics: <path d="M2.5 13.5h11M4 11V7M7 11V4M10 11V8M13 11V5" />,
  chevron: <path d="M4 6l4 4 4-4" />,
};

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 256 256" aria-hidden>
      <path
        fill="currentColor"
        d="M28 16H84A12 12 0 0 1 96 28V128A32 32 0 0 0 160 128V28A12 12 0 0 1 172 16H228A12 12 0 0 1 240 28V176A64 64 0 0 1 176 240H80A64 64 0 0 1 16 176V28A12 12 0 0 1 28 16Z"
      />
    </svg>
  );
}

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden>
      {paths[name]}
    </svg>
  );
}
