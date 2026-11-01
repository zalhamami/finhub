import { Notifications } from '@mantine/notifications';
import { useMediaQuery } from '@mantine/hooks';
import classes from './NotificationsHost.module.css';

/** Toast host: top-center on mobile (< sm), bottom-right on desktop. Above Modal/Drawer and the tab bar. */
export function NotificationsHost() {
  const desktop = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  return (
    <Notifications
      position={desktop ? 'bottom-right' : 'top-center'}
      limit={3}
      autoClose={3000}
      zIndex={1000}
      classNames={{ root: classes.root }}
    />
  );
}
