import { Alert, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ApiCategory, CategoryKind, CategoryPayload } from '../lib/api';
import { CATEGORY_KIND_LABEL, parentOptions } from '../lib/categories';
import { CATEGORY_ICONS } from '../lib/icons';
import {
  categoryFormSchema,
  emptyCategoryForm,
  zodFormResolver,
  type CategoryFormValues,
} from '../lib/schemas';
import { ColorNamePicker } from '../ui/ColorNamePicker';
import { IconPicker } from '../ui/IconPicker';

export interface CategoryFormProps {
  /** edit mode when present */
  category?: ApiCategory;
  /** kind for a new category (the active tab); an existing category keeps its own */
  kind: CategoryKind;
  /** the category roots (nested API tree) used to offer parents */
  roots: ApiCategory[];
  submitting?: boolean;
  error?: string | null;
  onSubmit: (payload: Omit<CategoryPayload, 'kind'>) => void;
  onToggleArchive?: () => void;
  onDelete?: () => void;
}

const toValues = (c: ApiCategory): CategoryFormValues => ({
  name: c.name,
  parent_id: c.parent_id ?? '',
  icon: c.icon ?? '',
  color: c.color ?? '',
});

export function CategoryForm({
  category,
  kind,
  roots,
  submitting,
  error,
  onSubmit,
  onToggleArchive,
  onDelete,
}: CategoryFormProps) {
  const form = useForm<CategoryFormValues>({
    mode: 'controlled',
    initialValues: category ? toValues(category) : emptyCategoryForm(),
    validate: zodFormResolver<CategoryFormValues>(categoryFormSchema),
  });
  const effectiveKind = category?.kind ?? kind;
  // A category with its own children stays top level (the UI shows two levels).
  const canHaveParent = !category || category.children.length === 0;
  const parents = parentOptions(roots, effectiveKind, category?.id);

  return (
    <form
      noValidate
      onSubmit={form.onSubmit((values) => onSubmit(categoryFormSchema.parse(values)))}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Jenis: {CATEGORY_KIND_LABEL[effectiveKind]}
        </Text>
        <TextInput
          label="Nama kategori"
          placeholder="mis. Makan siang"
          withAsterisk
          data-autofocus
          {...form.getInputProps('name')}
        />
        {canHaveParent && (
          <Select
            label="Induk"
            placeholder="Tanpa induk (kategori utama)"
            clearable
            data={parents.map((p) => ({ value: p.id, label: p.name }))}
            value={form.values.parent_id || null}
            onChange={(v) => form.setFieldValue('parent_id', v ?? '')}
          />
        )}
        <IconPicker
          value={form.values.icon}
          onChange={(k) => form.setFieldValue('icon', k)}
          icons={CATEGORY_ICONS}
        />
        <ColorNamePicker
          value={form.values.color}
          onChange={(c) => form.setFieldValue('color', c)}
        />

        {error && (
          <Alert color="gray" icon={<IconAlertCircle size={20} stroke={1.75} />} role="alert">
            {error}
          </Alert>
        )}

        <Group justify="space-between" mt="xs">
          <Group gap="xs">
            {category && onToggleArchive && (
              <Button variant="default" onClick={onToggleArchive}>
                {category.archived_at ? 'Aktifkan lagi' : 'Arsipkan'}
              </Button>
            )}
            {category && onDelete && (
              <Button variant="subtle" color="gray" onClick={onDelete}>
                Hapus
              </Button>
            )}
          </Group>
          <Button type="submit" loading={submitting}>
            Simpan
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
