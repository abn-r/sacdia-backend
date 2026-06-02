# SACDIA Backend Benchmarking

**Estado**: ACTIVE

Suite local para medir rendimiento y estrés de la API SACDIA con `autocannon`.

## Qué mide

- Throughput promedio (`req/s`).
- Latencia `p50`, `p95`, `p99` y máxima.
- Errores, timeouts y respuestas no-2xx.
- Capacidad estable estimada: el mayor escalón que queda bajo los umbrales configurados.

Por defecto un escalón es estable si cumple:

- `errorRate <= 1%`.
- `p95 <= 500ms`.

Estos umbrales se pueden ajustar con `--max-error-rate` y `--max-p95-ms`.

## Seguridad operativa

El runner solo permite targets locales por defecto (`localhost`, `127.0.0.1`, `::1`).
Para staging/remoto hay que habilitarlo explícitamente:

```bash
BENCH_ALLOW_REMOTE=1 BENCH_URL=https://staging-api.example.com pnpm run benchmark:baseline
```

No ejecutes `stress` o `spike` contra producción sin ventana acordada, monitoreo activo y rollback listo. Un benchmark no es magia: si le pegás sin control a producción, estás generando tráfico real y podés tumbarla.

## Prerrequisitos

1. Instalar dependencias:
   ```bash
   pnpm install
   ```
2. Levantar la API en otra terminal:
   ```bash
   pnpm run start:dev
   ```
3. Confirmar health:
   ```bash
   curl http://localhost:3000/api/v1/health
   ```

## Comandos rápidos

```bash
# Smoke corto: confirma que el target responde
pnpm run benchmark:smoke

# Baseline: referencia estable para comparar versiones
pnpm run benchmark:baseline

# Stress: rampa 25 -> 50 -> 100 -> 200 conexiones
pnpm run benchmark:stress

# Spike: pico repentino y recuperación
pnpm run benchmark:spike
```

Los reportes JSON se escriben en `reports/benchmarks/` y están ignorados por Git.

### Modo laboratorio para medir más allá del rate limit

El backend tiene rate limiting global por IP. Si querés medir capacidad de servidor en local sin que el resultado sea solo `429 Too Many Requests`, podés simular clientes distribuidos rotando `x-forwarded-for`:

```bash
pnpm run benchmark:stress -- --rotate-x-forwarded-for
```

Este modo es **solo local**. El runner lo bloquea para targets remotos porque, conceptualmente, saltea el límite por IP y sería irresponsable usarlo contra producción.

## Medir un endpoint específico

```bash
pnpm run benchmark:baseline -- --endpoint /api/v1/health
```

Con token JWT:

```bash
BENCH_TOKEN='eyJ...' pnpm run benchmark:baseline -- --endpoint /api/v1/auth/me
```

Con headers extra:

```bash
pnpm run benchmark:baseline -- \
  --endpoint /api/v1/health \
  --header 'x-benchmark-run: manual'
```

Con body:

```bash
pnpm run benchmark:baseline -- \
  --method POST \
  --endpoint /api/v1/auth/login \
  --body '{"email":"bench@example.com","password":"secret"}'
```

## Escenario multi-endpoint

Existe un escenario read-only de ejemplo:

```bash
pnpm run benchmark:baseline -- --scenario scripts/benchmarks/sacdia-public.json
```

Formato:

```json
{
  "name": "sacdia-public-readiness",
  "defaults": { "method": "GET" },
  "targets": [
    { "name": "health", "endpoint": "/api/v1/health" },
    { "name": "swagger-docs", "endpoint": "/api" }
  ]
}
```

## Interpretación

La línea importante es `Capacidad estable estimada`.
Eso NO significa “máximo absoluto”; significa “último punto donde la API sostuvo tráfico dentro del presupuesto de latencia y errores”.

Para una lectura seria, compará:

- baseline local vs staging;
- endpoints públicos vs endpoints con DB;
- con Redis activo vs sin Redis;
- cold start vs app ya caliente;
- p95/p99, no solo req/s promedio.

Si el `req/s` sube pero p95/p99 explotan, no ganaste potencia: solo acumulaste deuda en cola.
