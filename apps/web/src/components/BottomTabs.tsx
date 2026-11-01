import { Link, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import classes from './BottomTabs.module.css';
import { TAB_ITEMS, isTabActive } from './nav';

/** Mobile tab bar (hidden from `sm` up). */
export function BottomTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className={classes.tabbar} aria-label="Navigasi utama">
      {TAB_ITEMS.map((tab) => {
        const { to, label, icon: Icon } = tab;
        const active = isTabActive(tab, pathname);
        return (
          <Link
            key={to}
            to={to}
            className={clsx(classes.tab, active && classes.active)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={24} stroke={1.75} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
