import { notifications } from '@mantine/notifications';

/** Success toast (sage / `income` token). Config lives in `components/NotificationsHost`. */
export function notifySuccess(title: string, message?: string): void {
  notifications.show({ title, message: message ?? '', color: 'income' });
}

/** Error toast (clay / `expense` token; errors may use clay). `message` is a friendlyError text. */
export function notifyError(message: string, title = 'Gagal'): void {
  notifications.show({ title, message, color: 'expense', autoClose: 5000 });
}
