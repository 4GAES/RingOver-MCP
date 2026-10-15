# Llamadas · España (Ringover)

Analítica diaria de las llamadas de Ringover del equipo comercial de 4Geeks Academy España, con panel web en **https://ringover.duckdns.org** y servidor **MCP** para consultar los datos desde la IA.

## Métricas

Las definiciones viven en un solo sitio, `src/shared/metrics.ts`, y las usan igual el panel, la API y el MCP. Los días se cuentan en hora de Madrid.

| Métrica | Cómo se calcula |
|---|---|
| Llamadas | Todas las del comercial: salientes y entrantes, contestadas o no. |
| Nuevas | Llamadas a un número con el que el equipo aún no había hablado (incluye los intentos sin respuesta y la primera conversación). |
| Antiguas | Llamadas a números con los que ya se había hablado (seguimientos). |
| Tiempo en llamada | Tiempo real de conversación (`incall_duration`) de las contestadas. |
| Tiempo al teléfono | Duración total: tono, espera y conversación (`total_duration`). |
| Tiempo conectado | Tiempo con Ringover abierto. La API no lo guarda: la app lo mide cada minuto desde que arrancó. |
| +15 min | Contestadas con 15 minutos o más de conversación. |
| −5 min | Contestadas con menos de 5 minutos (las no contestadas no cuentan). |
| Nuevas +15 min | Primeras conversaciones de 15 minutos o más. |

Una llamada cuenta como "contestada" solo si hubo conversación (más de 0 s). Los números se casan por sus últimos 9 dígitos. Las llamadas internas (extensiones) no cuentan.

Comparaciones: un día se compara con el mismo día de la semana anterior y, si es hoy, hasta la misma hora. Un mes en curso se compara con el mismo tramo del mes anterior. El resto de periodos, con el bloque anterior de la misma longitud.

Selección de comerciales: en Resumen y Llamadas se pueden elegir varios comerciales y todo (cifras, comparación, tabla, gráficos y "Ahora mismo") pasa a ser solo de ellos. La selección va en la URL (`?comerciales=101,103`, el 0 son las llamadas sin asignar), se mantiene al cambiar de pantalla y el navegador recuerda la última. Filtrar no cambia qué llamadas son nuevas: eso siempre se decide respecto a todo el equipo.

## Acceso

Se entra con la cuenta de **4Geeks Center**: mismo usuario, misma contraseña y mismo permiso. Pueden entrar los admin y quien tenga el dashboard de contactabilidad. La app no guarda contraseñas: valida contra Center y revisa la sesión cada 5 minutos.

## MCP

Endpoint: `https://ringover.duckdns.org/mcp`, de solo lectura y con token Bearer (guardado en `.env.mcp`, fuera de git).

```bash
claude mcp add --transport http --scope user ringover https://ringover.duckdns.org/mcp --header "Authorization: Bearer $(cat .env.mcp)"
```

Herramientas:

| Herramienta | Qué hace | Grupo |
|---|---|:-:|
| `resumen` | Las 9 métricas de un día o rango, con comparación y desglose por comercial. | ✓ |
| `evolucion` | Serie por día, semana o mes. | ✓ |
| `comparar` | Dos periodos cualesquiera, frente a frente. | ✓ |
| `ranking` | Comerciales ordenados por una métrica. | ✓ |
| `llamadas` | Listado de llamadas con filtros (nuevas, contestadas, duración, número). | ✓ |
| `historial_numero` | Todas las llamadas con un teléfono. | |
| `jornada` | Cómo fue el día de un comercial: tramos conectado y huecos sin llamar. | |
| `estado_ahora` | Quién está conectado o en llamada en este momento. | ✓ |
| `comerciales` | Lista de comerciales. | |
| `definiciones` | Cómo se calcula todo y lo frescos que están los datos. | |
| `alertas` | Señales del día: cada comercial frente a su propia media. | ✓ |
| `seguimientos_pendientes` | Leads con una buena primera conversación que nadie ha vuelto a llamar. | ✓ |
| `mejores_horas` | Tasa de contacto por día de la semana y hora. | ✓ |
| `comparar_comerciales` | Varios comerciales lado a lado, con ratios. | ✓ |
| `informe` | Informe diario o semanal en Markdown, listo para Slack o email. | ✓ |

Prompts (comandos en Claude): `/informe_diario`, `/informe_semanal`, `/revisar_comercial`, `/revisar_grupo` y `/seguimientos`.

Para mirar a un grupo, las herramientas aceptan `comerciales` con varios nombres, emails o ids (por ejemplo `["Ana", "Luis", "marta@4geeksacademy.com"]`). Todas las cifras pasan a ser solo de ese grupo. Funciona en `resumen`, `evolucion`, `comparar`, `ranking`, `llamadas`, `estado_ahora`, `alertas`, `seguimientos_pendientes`, `mejores_horas` e `informe`. Para un solo comercial sigue valiendo `comercial`. Si algún nombre no existe, el error dice cuál. El prompt `/revisar_grupo` analiza un grupo de una vez.

## Sincronización

| Tarea | Frecuencia |
|---|---|
| Llamadas | Cada 3 minutos de 7 a 22 h y cada 30 minutos fuera de ese horario. |
| Repaso de los últimos 4 días | Cada noche a las 3 h, porque estados y grabaciones cambian después de la llamada. |
| Presencia | Cada minuto. |
| Histórico | Al arrancar, hacia atrás hasta 36 meses. Si se corta, retoma donde lo dejó. |

El cliente de Ringover respeta el límite de 2 peticiones por segundo. Reintenta con espera exponencial y aleatoria, y tiene un cortacircuitos que pausa las llamadas a la API si falla varias veces seguidas.

Para que el tiempo conectado funcione, la clave de la API necesita el permiso **Monitoring**. Si falta, el panel lo avisa.

## Desarrollo

```bash
npm install
```

```bash
node --import tsx scripts/seed-demo.ts
```

```bash
npm run dev
```

`seed-demo.ts` genera datos de demostración en `data/demo.db`. `npm run dev` arranca el panel en http://localhost:5173 con un Center simulado: entra con `demo@4geeks.test` y la contraseña `demo`.

```bash
npm run check
```

```bash
npm run test:e2e
```

`npm run check` pasa Biome, TypeScript y los tests unitarios (Vitest). `npm run test:e2e` lanza Playwright con Chrome, en escritorio y en móvil.

Stack: Node 22, Hono, `node:sqlite`, Zod, MCP SDK, React 19, TanStack Query, Vite y gráficos SVG propios. La paleta de los gráficos está validada para daltonismo.

## Despliegue (Hetzner)

```bash
deploy/deploy.sh
```

| Elemento | En el servidor |
|---|---|
| Código | `/opt/ringover` |
| Proceso | PM2 `ringover`, en `127.0.0.1:3020` |
| Proxy | nginx `ringover.duckdns.org` |
| Base de datos | SQLite en `/opt/ringover/data` |

El primer despliegue fue con `deploy/deploy.sh --primera`, que crea `.env`, nginx y PM2. La clave de Ringover se copia de ControlTower con `deploy/importar-clave.sh`; vuelve a ejecutarlo si se rota la clave.

## Pruebas del MCP

| Comando | Qué prueba |
|---|---|
| `npm test` | Unitarias y de integración. Incluye la batería de aceptación completa contra un servidor local con datos de demo. |
| `node --import tsx scripts/mcp-acceptance.ts --url https://ringover.duckdns.org/mcp --token-file .env.mcp` | La misma batería contra producción, con el cliente MCP oficial (unas 54 comprobaciones, a ritmo para no superar el límite). |
| `scripts/mcp-prueba-ia.sh` | Claude real respondiendo 6 preguntas solo con el MCP. Muestra qué herramientas eligió. Requiere `claude /login`. |

La batería de aceptación comprueba:

- **Protocolo:** identidad del servidor, herramientas, prompts y recursos.
- **Herramientas:** las 15, con su latencia y su tamaño.
- **Coherencia entre herramientas:** el equipo es la suma de los comerciales; ranking, listado, evolución, comparar e informe dan las mismas cifras; los atajos de periodo equivalen a las fechas escritas a mano; "hoy" se compara hasta la misma hora.
- **Validación:** fechas imposibles, rangos, comerciales que no existen y límites.
- **Seguridad:** 401 con `resource_metadata`, token en la URL rechazado, `bearer` en minúsculas aceptado, CORS y descubrimiento OAuth.
- **Rendimiento:** consultas seguidas y en paralelo.
