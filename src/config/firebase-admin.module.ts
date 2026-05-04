import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as admin from 'firebase-admin';

type FirebaseCredentials = {
  projectId: string;
  privateKey: string;
  clientEmail: string;
  source: 'service_account_json' | 'legacy_env';
};

@Module({})
export class FirebaseAdminModule {
  constructor() {
    // Inicializar Firebase Admin SDK
    if (!admin.apps.length) {
      try {
        const credentials = this.resolveCredentials();
        if (!credentials) {
          console.warn(
            '⚠️  Firebase Admin credentials not found. FCM notifications will be disabled.',
          );
          return;
        }

        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: credentials.projectId,
            privateKey: credentials.privateKey,
            clientEmail: credentials.clientEmail,
          }),
        });

        console.log(
          `✅ Firebase Admin initialized successfully (source: ${credentials.source})`,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('❌ Failed to initialize Firebase Admin:', message);
        console.warn('Firebase services (FCM) will be disabled.');
      }
    }
  }

  private resolveCredentials(): FirebaseCredentials | null {
    const jsonBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (this.hasValue(jsonBase64) || this.hasValue(jsonRaw)) {
      const parsed = this.parseServiceAccountJson(jsonBase64, jsonRaw);
      if (parsed) {
        return {
          ...parsed,
          source: 'service_account_json',
        };
      }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    const hasLegacyValues =
      this.hasValue(projectId) &&
      this.hasValue(privateKey) &&
      this.hasValue(clientEmail);

    if (!hasLegacyValues) {
      return null;
    }

    return {
      projectId: projectId!.trim(),
      privateKey: this.normalizePrivateKey(privateKey!),
      clientEmail: clientEmail!.trim(),
      source: 'legacy_env',
    };
  }

  private parseServiceAccountJson(
    jsonBase64?: string,
    jsonRaw?: string,
  ): Omit<FirebaseCredentials, 'source'> | null {
    try {
      const payload = this.hasValue(jsonBase64)
        ? Buffer.from(jsonBase64!.trim(), 'base64').toString('utf8')
        : jsonRaw!.trim();

      const parsed = JSON.parse(payload) as {
        project_id?: string;
        private_key?: string;
        client_email?: string;
      };

      if (
        !this.hasValue(parsed.project_id) ||
        !this.hasValue(parsed.private_key) ||
        !this.hasValue(parsed.client_email)
      ) {
        console.warn(
          '⚠️  Firebase service account JSON is missing project_id/private_key/client_email. FCM disabled.',
        );
        return null;
      }

      return {
        projectId: parsed.project_id!.trim(),
        privateKey: this.normalizePrivateKey(parsed.private_key!),
        clientEmail: parsed.client_email!.trim(),
      };
    } catch (error) {
      console.warn(
        '⚠️  Firebase service account JSON could not be parsed. Falling back to legacy env vars.',
      );
      return null;
    }
  }

  private hasValue(value?: string): boolean {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed) return false;

    const placeholderPatterns = [
      /YOUR_/i,
      /your-project-id/i,
      /firebase-adminsdk-xxxxx/i,
      /YOUR_PRIVATE_KEY_HERE/i,
    ];

    return !placeholderPatterns.some((pattern) => pattern.test(trimmed));
  }

  private normalizePrivateKey(privateKey: string): string {
    return privateKey.replace(/\\n/gm, '\n');
  }
}

// Exportar instancia para usar en servicios
export const firebaseAdmin = admin;
