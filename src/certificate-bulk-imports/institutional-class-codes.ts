export const INSTITUTIONAL_CLASS_ASSET_CODES = new Set(['GM-02', 'GM-03']);

export function isInstitutionalInvestitureClass(
  assetCode: string | null | undefined,
): boolean {
  return INSTITUTIONAL_CLASS_ASSET_CODES.has(assetCode ?? '');
}
