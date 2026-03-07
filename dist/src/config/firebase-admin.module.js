"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firebaseAdmin = exports.FirebaseAdminModule = void 0;
const common_1 = require("@nestjs/common");
const admin = __importStar(require("firebase-admin"));
let FirebaseAdminModule = class FirebaseAdminModule {
    constructor() {
        if (!admin.apps.length) {
            try {
                const credentials = this.resolveCredentials();
                if (!credentials) {
                    console.warn('⚠️  Firebase Admin credentials not found. FCM notifications will be disabled.');
                    return;
                }
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: credentials.projectId,
                        privateKey: credentials.privateKey,
                        clientEmail: credentials.clientEmail,
                    }),
                });
                console.log(`✅ Firebase Admin initialized successfully (source: ${credentials.source})`);
            }
            catch (error) {
                console.error('❌ Failed to initialize Firebase Admin:', error.message);
                console.warn('Firebase services (FCM) will be disabled.');
            }
        }
    }
    resolveCredentials() {
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
        const hasLegacyValues = this.hasValue(projectId) &&
            this.hasValue(privateKey) &&
            this.hasValue(clientEmail);
        if (!hasLegacyValues) {
            return null;
        }
        return {
            projectId: projectId.trim(),
            privateKey: this.normalizePrivateKey(privateKey),
            clientEmail: clientEmail.trim(),
            source: 'legacy_env',
        };
    }
    parseServiceAccountJson(jsonBase64, jsonRaw) {
        try {
            const payload = this.hasValue(jsonBase64)
                ? Buffer.from(jsonBase64.trim(), 'base64').toString('utf8')
                : jsonRaw.trim();
            const parsed = JSON.parse(payload);
            if (!this.hasValue(parsed.project_id) ||
                !this.hasValue(parsed.private_key) ||
                !this.hasValue(parsed.client_email)) {
                console.warn('⚠️  Firebase service account JSON is missing project_id/private_key/client_email. FCM disabled.');
                return null;
            }
            return {
                projectId: parsed.project_id.trim(),
                privateKey: this.normalizePrivateKey(parsed.private_key),
                clientEmail: parsed.client_email.trim(),
            };
        }
        catch (error) {
            console.warn('⚠️  Firebase service account JSON could not be parsed. Falling back to legacy env vars.');
            return null;
        }
    }
    hasValue(value) {
        if (!value)
            return false;
        const trimmed = value.trim();
        if (!trimmed)
            return false;
        const placeholderPatterns = [
            /YOUR_/i,
            /your-project-id/i,
            /firebase-adminsdk-xxxxx/i,
            /YOUR_PRIVATE_KEY_HERE/i,
        ];
        return !placeholderPatterns.some((pattern) => pattern.test(trimmed));
    }
    normalizePrivateKey(privateKey) {
        return privateKey.replace(/\\n/gm, '\n');
    }
};
exports.FirebaseAdminModule = FirebaseAdminModule;
exports.FirebaseAdminModule = FirebaseAdminModule = __decorate([
    (0, common_1.Module)({}),
    __metadata("design:paramtypes", [])
], FirebaseAdminModule);
exports.firebaseAdmin = admin;
//# sourceMappingURL=firebase-admin.module.js.map