import { Drawer, Modal } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { ReactNode } from 'react';
import classes from './ResponsiveFormSheet.module.css';

interface Props {
  opened: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** Centered Modal from `sm` up, full-height bottom Drawer on mobile. Content is the same. */
export function ResponsiveFormSheet({ opened, onClose, title, children }: Props) {
  const desktop = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  if (desktop) {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        title={title}
        size="lg"
        classNames={{ title: classes.title }}
      >
        {children}
      </Modal>
    );
  }
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={title}
      position="bottom"
      size="100%"
      classNames={{ title: classes.title, body: classes.drawerBody }}
    >
      {children}
    </Drawer>
  );
}
