export type SensitiveUserSubresourceFamily = 'health' | 'emergency_contacts' | 'legal_representative' | 'post_registration';
export type SensitiveUserSubresourceMode = 'read' | 'update';
export type SensitiveUserSubresourcePolicy = {
    finePermission: string;
    legacyFallbackPermission: string;
};
export declare function getSensitiveUserSubresourcePolicy(family: SensitiveUserSubresourceFamily, mode: SensitiveUserSubresourceMode): SensitiveUserSubresourcePolicy;
export declare function getSensitiveUserSubresourceFallbackPermission(family: SensitiveUserSubresourceFamily, mode: SensitiveUserSubresourceMode): string;
