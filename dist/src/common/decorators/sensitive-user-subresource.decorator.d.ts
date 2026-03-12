import { type SensitiveUserSubresourceFamily, type SensitiveUserSubresourceMode } from '../guards/sensitive-user-subresource-policy';
export declare const SENSITIVE_USER_SUBRESOURCE_KEY = "sensitive_user_subresource";
export type SensitiveUserSubresourceMetadata = {
    family: SensitiveUserSubresourceFamily;
    mode: SensitiveUserSubresourceMode;
};
export declare function SensitiveUserSubresource(family: SensitiveUserSubresourceFamily, mode: SensitiveUserSubresourceMode, options?: {
    ownerParam?: string;
}): ClassDecorator & MethodDecorator;
