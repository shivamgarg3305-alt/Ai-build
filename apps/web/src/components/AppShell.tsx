import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ChatIcon, MemoryIcon, SettingsIcon, TasksIcon } from './icons';

const items: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Conversation', icon: <ChatIcon />, end: true },
  { to: '/memory', label: 'Memory', icon: <MemoryIcon /> },
  { to: '/tasks', label: 'Tasks', icon: <TasksIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function AppShell() {
  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true" />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Assistant
        </div>
        <nav className="nav" aria-label="Primary">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main id="main" className="stage" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
