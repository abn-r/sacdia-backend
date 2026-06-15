const DELETED_ACCOUNT_EMAIL_PATTERN = /^deleted-[0-9a-f-]+@sacdia\.deleted$/i;

export function isDeletedAccountSnapshot(user: {
  active?: boolean | null;
  email?: string | null;
}): boolean {
  return (
    user.active === false &&
    DELETED_ACCOUNT_EMAIL_PATTERN.test(user.email ?? '')
  );
}
