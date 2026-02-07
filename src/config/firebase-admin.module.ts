import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Module({})
export class FirebaseAdminModule {
  constructor() {
    // Inicializar Firebase Admin SDK
    if (!admin.apps.length) {
      try {
        // Validar que las variables de entorno estén presentes
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

        if (!projectId || !privateKey || !clientEmail) {
          console.warn(
            '⚠️  Firebase Admin credentials not found. FCM notifications will be disabled.',
          );
          console.warn(
            'Missing:',
            !projectId ? 'FIREBASE_PROJECT_ID ' : '',
            !privateKey ? 'FIREBASE_PRIVATE_KEY ' : '',
            !clientEmail ? 'FIREBASE_CLIENT_EMAIL' : '',
          );
          return;
        }

        // Procesar la clave privada para manejar correctamente los saltos de línea
        const formattedPrivateKey = privateKey.replace(/\\n/gm, '\n');

        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            privateKey: formattedPrivateKey,
            clientEmail,
          }),
        });

        console.log('✅ Firebase Admin initialized successfully');
      } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin:', error.message);
        console.warn('Firebase services (FCM) will be disabled.');
      }
    }
  }
}

// Exportar instancia para usar en servicios
export const firebaseAdmin = admin;
