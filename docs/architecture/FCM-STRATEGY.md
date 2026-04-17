# FCM Delivery Strategy — SACDIA

**Date:** 2026-04-17
**Status:** Decision
**Author:** backend-developer agent
**Context:** Backend added `notification_preferences` (master toggle + 5 categories). Mobile will wire `_saveNotifPref` to per-category toggles. Current system sends push to direct tokens with server-side filtering.

---

## 1. Tabla comparativa

| Aspecto | FCM Topics | Tokens Directos (actual) |
|---|---|---|
| **Latencia envio masivo** | Baja — FCM distribuye fan-out internamente; el backend hace 1 llamada | Alta — backend consulta DB, chunka tokens en batches de 500, N llamadas HTTP a FCM |
| **Control granular por user** | Ninguno despues del subscribe; FCM no conoce preferencias internas | Total — `notification_preferences` filtra server-side antes de cualquier push |
| **Revocacion / unsubscribe** | `unsubscribeFromTopic()` requiere coordinacion mobile + backend; puede quedar subscrito si falla | Inmediato — marcar token `active=false` o filtrar por pref en la query |
| **Multi-device por user** | Cada dispositivo se subscribe independiente; un device viejo olvidado sigue recibiendo | `user_fcm_tokens` agrupa por `user_id`; el backend envia a todos los tokens activos del user |
| **Filtrado server-side** | Imposible post-subscribe — FCM entrega a TODOS los suscriptores del topic | Completo — `filterAllowedUsers()` / `isAllowedForUser()` ya implementado; compatible con cualquier logica de negocio |
| **Costo / cuota Firebase** | Sin limite de mensajes por topic en plan Spark/Blaze; pero 1 topic = 1 mensaje aunque el sub-set tenga 3 users | Mismo precio por mensaje; el costo real es el volumen de tokens, no la estrategia |
| **Complejidad implementacion** | Baja para envio masivo homogeneo; alta para segmentacion dinamica (topic naming, sync state) | Media — ya implementada; complejidad crece con la cantidad de combinaciones role x club |
| **Debug / observabilidad** | Opaca — FCM no reporta delivery por recipient dentro de un topic | Clara — `notification_deliveries` tiene 1 fila por user; `tokens_sent/failed` en `notification_logs` |
| **Segmentacion dinamica** (ej: directores de club X) | Requiere topic `directors:club:{id}` por cada combinacion; explosion de topics con multi-club | Query directa sobre `club_role_assignments` + `users_roles`; ya funciona con `sendToSectionRole` y `sendToGlobalRole` |
| **Resiliencia a token expiration** | N/A — el topic name no expira; el dispositivo puede tener un token viejo y seguir recibiendo | `PERMANENT_FCM_ERROR_CODES` ya marca tokens invalidos como `active=false` en cada envio |

---

## 2. Trade-offs reales para SACDIA

**Menores de edad (GDPR/COPPA).** SACDIA maneja conquistadores que son menores. Con tokens directos el backend mantiene control total sobre a quien se envia cada notificacion y puede excluir ciertas categorias por edad del perfil sin tocar la configuracion de FCM. Con topics, una vez que el dispositivo se subscribe, el backend pierde esa capacidad de veto.

**Multi-club.** Un user puede tener `club_role_assignments` en multiples secciones. Con topics necesitarias `activities:section:{id}` por cada seccion, y el user se subscribiria a N topics. Con tokens directos el backend resuelve la union de secciones en una sola query y envia un unico mensaje al user.

**Notificaciones mixtas (categoria + contexto de club).** La combinacion `activities` en la seccion 42 para el rol `director` no tiene una traduccion directa a un topic FCM sin un esquema de nombres como `activities:section:42:director`, lo cual escala cuadraticamente con clubes x roles x categorias. Con tokens directos, `sendToSectionRole(42, ['director'], ...)` lo resuelve en una query.

**Historial auditable (compliance).** `notification_deliveries` provee un registro por recipient obligatorio para GDPR (derecho de acceso del usuario a sus datos). Con topics, FCM no devuelve lista de recipients — el audit log es imposible sin replicar la lista de subscribers en DB, lo cual elimina la ventaja de simplicidad de topics.

---

## 3. Recomendacion concreta

**Decision: Full Tokens Directos (mantener y madurar el sistema actual).**

Topics resuelven un unico problema bien: fan-out masivo a audiencias homogeneas sin control de acceso. SACDIA no tiene ese caso. Todos los envios son segmentados por rol, club, categoria o user — exactamente lo que los topics no pueden hacer sin un esquema de naming que explota en complejidad.

El sistema actual ya tiene la arquitectura correcta:
- `user_fcm_tokens` multi-device por user
- `notification_preferences` para opt-out granular server-side
- `notification_deliveries` para inbox auditable
- Token lifecycle management (permanent error codes → `active=false`)
- BullMQ para fan-out asincrono con retry

**Lo que falta** es madurar el path BullMQ para los metodos sincronos de fallback (descripto en el Plan de Implementacion), no cambiar de estrategia.

**Cuando reconsiderar:** si SACDIA supera 50.000 usuarios activos con notificaciones verdaderamente broadcast (sin filtro de rol ni club), el batch de 500 tokens por llamada FCM empieza a generar latencia apreciable. En ese punto, FCM Topics para la categoria `reminders` (recordatorios generales) seria razonable como complemento, no reemplazo.

**Riesgos de mantener tokens directos:**
- Query pressure en `user_fcm_tokens` con muchos usuarios — mitigado con el indice en `(user_id, active)` y el BullMQ processor que hace el fan-out fuera del request cycle.
- Token staleness — mitigado con `last_used_at` tracking y el mecanismo de deactivacion por error permanente.

---

## 4. Plan de implementacion

Los pasos estan priorizados por impacto y dependencia. El estado actual es funcional; estos pasos llevan el sistema de "funciona" a "production-grade".

**Paso 1 — Completar la migracion async en el processor (backend)** ✅ COMPLETADO 2026-04-17
`sendToClubMembersSync` no tenia path BullMQ equivalente. Se agrego job type `send-to-club-members` con interface `SendToClubMembersJobData` en `notifications.processor.ts` + handler `handleSendToClubMembers`. `NotificationsService.sendToClubMembers` ahora encola via BullMQ cuando Redis esta disponible y cae al sync fallback en caso contrario. 5 unit tests + 1 dedup test cubriendo no-members, all-opted-out, inbox-first, FCM multicast, y deduplicacion.

**Paso 2 — Wiring mobile de notification_preferences (mobile)**
Verificado: `PATCH /api/v1/users/me/notification-preferences` esta completo con logica server-side para `master=false` (cascada a las 5 categorias). DTOs aceptan updates parciales. No requiere cambios backend. Mobile debe llamar este endpoint al togglear cada categoria.

**Paso 3 — Indice parcial en user_fcm_tokens (DB)** ✅ COMPLETADO 2026-04-17
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_fcm_tokens_user_active
  ON user_fcm_tokens (user_id)
  WHERE active = true;
```
Migration: `20260417183839_user_fcm_tokens_partial_index`. Aplicada a development + staging + production via psql manual (CONCURRENTLY no admite transaccion — INSERT en `_prisma_migrations` separado).

**Paso 4 — Token cleanup job periodico (backend)** ✅ YA ESTABA IMPLEMENTADO
`FcmTokensService.cleanupOldTokens()` tiene `@Cron('0 3 * * 0')` (domingo 3am). Politica: hard delete (`deleteMany`) de tokens con `last_used < now() - 90 days`. Log del count al finalizar.

**Paso 5 — Indice en notification_deliveries para inbox (DB)**
```sql
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_unread
  ON notification_deliveries (user_id, created_at DESC)
  WHERE read_at IS NULL;
```
Acelera el endpoint de bandeja de entrada (`getNotificationHistory`) y el `getUnreadCount`. Pendiente de migration.

**Paso 6 (original Paso 8) — Source-to-category mapping (backend)** ✅ COMPLETADO 2026-04-17
Creado `notification-source-map.constants.ts` con mapping explicito de los 19 source strings del sistema a sus 4 categorias mobile activas. `NotificationPreferencesService.extractCategory()` usa el mapa primero (lookup O(1)) y cae al prefix-matching como fallback. Sources no mapeados loguean un warning. 26 unit tests cubriendo mapping, completitud de callsites, y casos borde.

**Paso 7 — Limite de tokens por user (backend + DB)**
Limitar a 5 tokens activos por user. En `FcmTokensService.registerToken()`, despues del upsert, hacer DELETE de los tokens mas viejos que excedan el limite.

**Paso 8 — Exponer metricas de delivery en admin (backend)**
Agregar endpoint `GET /api/v1/admin/notifications/stats` que retorne: tokens activos totales, tokens inactivos (ultimos 30 dias), tasa de delivery (tokens_sent / (tokens_sent + tokens_failed)) por dia.
