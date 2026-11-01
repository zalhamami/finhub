import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

interface Props {
  opened: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  /** friendly failure text from the last attempt (e.g. the 409 "archive instead" hint) */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Small confirm modal. Destructive confirms use the neutral dark color; clay is for overspending only. */
export function ConfirmDialog({
  opened,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Batal',
  loading,
  error,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="sm">
      <Stack gap="md">
        <Text size="sm">{message}</Text>
        {error && (
          <Alert color="gray" icon={<IconAlertCircle size={20} stroke={1.75} />} role="alert">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button color="dark" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
