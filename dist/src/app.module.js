"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const throttler_1 = require("@nestjs/throttler");
const core_1 = require("@nestjs/core");
const nestjs_pino_1 = require("nestjs-pino");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const prisma_module_1 = require("./prisma/prisma.module");
const common_module_1 = require("./common/common.module");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const emergency_contacts_module_1 = require("./emergency-contacts/emergency-contacts.module");
const legal_representatives_module_1 = require("./legal-representatives/legal-representatives.module");
const post_registration_module_1 = require("./post-registration/post-registration.module");
const catalogs_module_1 = require("./catalogs/catalogs.module");
const clubs_module_1 = require("./clubs/clubs.module");
const classes_module_1 = require("./classes/classes.module");
const honors_module_1 = require("./honors/honors.module");
const activities_module_1 = require("./activities/activities.module");
const finances_module_1 = require("./finances/finances.module");
const camporees_module_1 = require("./camporees/camporees.module");
const notifications_module_1 = require("./notifications/notifications.module");
const certifications_module_1 = require("./certifications/certifications.module");
const folders_module_1 = require("./folders/folders.module");
const inventory_module_1 = require("./inventory/inventory.module");
const rbac_module_1 = require("./rbac/rbac.module");
const health_controller_1 = require("./health/health.controller");
const admin_module_1 = require("./admin/admin.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
            }),
            nestjs_pino_1.LoggerModule.forRoot({
                forRoutes: [{ path: '/{*path}', method: common_1.RequestMethod.ALL }],
                pinoHttp: {
                    level: process.env.LOG_LEVEL ||
                        (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
                    autoLogging: false,
                    quietReqLogger: true,
                    redact: {
                        paths: [
                            'req.headers.authorization',
                            'req.headers.cookie',
                            'req.body.password',
                            'req.body.refreshToken',
                            'requestBody.password',
                            'requestBody.refreshToken',
                        ],
                        remove: true,
                    },
                    ...(process.env.NODE_ENV !== 'production' ||
                        process.env.LOG_PRETTY === 'true'
                        ? {
                            transport: {
                                target: 'pino-pretty',
                                options: {
                                    colorize: true,
                                    translateTime: 'SYS:standard',
                                    ignore: process.env.LOG_PRETTY_IGNORE ||
                                        'pid,hostname,req,res,responseTime',
                                    singleLine: false,
                                },
                            },
                        }
                        : {}),
                },
            }),
            throttler_1.ThrottlerModule.forRoot([
                {
                    name: 'short',
                    ttl: 1000,
                    limit: 3,
                },
                {
                    name: 'medium',
                    ttl: 10000,
                    limit: 20,
                },
                {
                    name: 'long',
                    ttl: 60000,
                    limit: 100,
                },
            ]),
            prisma_module_1.PrismaModule,
            common_module_1.CommonModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            emergency_contacts_module_1.EmergencyContactsModule,
            legal_representatives_module_1.LegalRepresentativesModule,
            post_registration_module_1.PostRegistrationModule,
            catalogs_module_1.CatalogsModule,
            clubs_module_1.ClubsModule,
            classes_module_1.ClassesModule,
            honors_module_1.HonorsModule,
            activities_module_1.ActivitiesModule,
            finances_module_1.FinancesModule,
            camporees_module_1.CamporeesModule,
            notifications_module_1.NotificationsModule,
            certifications_module_1.CertificationsModule,
            folders_module_1.FoldersModule,
            inventory_module_1.InventoryModule,
            rbac_module_1.RbacModule,
            admin_module_1.AdminModule,
        ],
        controllers: [app_controller_1.AppController, health_controller_1.HealthController],
        providers: [
            app_service_1.AppService,
            {
                provide: core_1.APP_GUARD,
                useClass: throttler_1.ThrottlerGuard,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map