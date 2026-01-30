"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors();
    const config = new swagger_1.DocumentBuilder()
        .setTitle('SACDIA API')
        .setDescription('API REST para Sistema de Administración de Clubes de Aventureros, Conquistadores y Guías Mayores')
        .setVersion('2.0')
        .addBearerAuth()
        .addTag('auth', 'Autenticación y autorización')
        .addTag('users', 'Gestión de usuarios')
        .addTag('clubs', 'Gestión de clubes')
        .addTag('roles', 'Gestión de roles y permisos')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('api', app, document, {
        swaggerOptions: {
            persistAuthorization: true,
        },
    });
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`\n🚀 Server running on: http://localhost:${port}`);
    console.log(`📖 Swagger docs on: http://localhost:${port}/api\n`);
}
bootstrap();
//# sourceMappingURL=main.js.map