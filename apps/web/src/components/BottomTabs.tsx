import { Link, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useTransactionSheet } from '../features/TransactionSheetContext';
import classes from './BottomTabs.module.css';
import { TAB_ITEMS, isTabActive } from './nav';

/** Mobile tab bar (hidden from `sm` up). The center "Tambah" tab opens the add-transaction sheet. */
export function BottomTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { openCreate } = useTransactionSheet();
  return (
    <nav className={classes.tabbar} aria-label="Navigasi utama">
      {TAB_ITEMS.map((tab) => {
        const Icon = tab.icon;
        if ('action' in tab) {
          return (
            <button
              key={tab.action}
              type="button"
              className={clsx(classes.tab, classes.add)}
              aria-label={tab.ariaLabel}
              onClick={openCreate}
            >
              <span className={classes.addIcon}>
                <Icon size={24} stroke={1.75} />
              </span>
              <span>{tab.label}</span>
            </button>
          );
        }
        const active = isTabActive(tab, pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={clsx(classes.tab, active && classes.active)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={24} stroke={1.75} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
