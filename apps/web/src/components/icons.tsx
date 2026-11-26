import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const ChatIcon = () => (
  <Icon><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3v-3H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" /></Icon>
);
export const MemoryIcon = () => (
  <Icon><path d="m12 3.5 8.5 4.25L12 12 3.5 7.75 12 3.5Z" /><path d="m3.5 12 8.5 4.25L20.5 12" /><path d="m3.5 16.25 8.5 4.25 8.5-4.25" /></Icon>
);
export const TasksIcon = () => (
  <Icon><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8.5 12.2 2.4 2.4 4.6-4.9" /></Icon>
);
export const SettingsIcon = () => (
  <Icon><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Icon>
);
