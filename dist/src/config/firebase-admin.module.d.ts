import * as admin from 'firebase-admin';
export declare class FirebaseAdminModule {
    constructor();
    private resolveCredentials;
    private parseServiceAccountJson;
    private hasValue;
    private normalizePrivateKey;
}
export declare const firebaseAdmin: typeof admin;
