import { Card, Stack, Text, Title } from '@mantine/core';
import { IconClockHour4 } from '@tabler/icons-react';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <Stack gap="md">
      <Title order={2}>{title}</Title>
      <Card>
        <Stack align="center" gap="xs" py="lg">
          <IconClockHour4 size={32} stroke={1.75} />
          <Text fw={600}>Segera hadir di M2</Text>
          <Text size="sm" c="dimmed">
            Halaman {title} sedang disiapkan.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
