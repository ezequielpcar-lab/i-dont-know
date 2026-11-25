# WebRadar – negocios sin web

App para iPad (web app instalable) que busca negocios en cualquier zona de España que **no tienen página web** o la tienen **anticuada**, te da sus **datos de contacto**, un **enlace a Google** y un **presupuesto (venta + mantenimiento) calculado con IA**.

## Qué hace

| Función | Cómo |
|---|---|
| Búsqueda por zona | Escribe barrio, ciudad o código postal (o pulsa 📍 *Aquí*), elige radio (500 m – 10 km) y sectores. |
| Sin web / con web | Pestañas *Sin web*, *Con web*, *Todos* y *Guardados*. Opción de ocultar cadenas/franquicias. |
| Datos de contacto | Teléfono (llamar, WhatsApp si es móvil, copiar), email (con mensaje preparado), Instagram, Facebook, web, dirección y horario. |
| Enlace a Google | *Ver en Google Maps* (reseñas, fotos, teléfono…) y *Buscar en Google*, con botón para copiar el enlace. |
| Precio con IA | *Analizar con IA*: Claude abre la web del negocio (o comprueba que no tiene), puntúa su modernidad de 0 a 10, lista los problemas, propone qué web hacerle, da **precio de venta** y **mantenimiento mensual** y te redacta un mensaje de contacto. |
| Precio rápido sin IA | Estimación orientativa por sector, visible siempre. |
| Seguimiento | Guarda negocios, márcalos (Pendiente, Contactado, Interesado, Presupuesto enviado, Cliente, Descartado) y añade notas. |
| Exportar | CSV (abre en Excel/Numbers) de guardados o resultados. |

Los datos de los negocios salen de **OpenStreetMap** (gratis, sin clave). OpenStreetMap no tiene todas las webs: un negocio marcado como "Sin web" puede tenerla. El análisis con IA lo comprueba buscando en internet.

## Ponerla en tu iPad

1. **Publicar la app** (una sola vez). En GitHub, ve a este repositorio → *Settings* → *Pages* → en *Source* elige **GitHub Actions**. El flujo `.github/workflows/pages.yml` la publica automáticamente en cada cambio; la dirección será `https://<tu-usuario>.github.io/i-dont-know/`.
   - GitHub Pages en repositorios privados requiere un plan de pago. Si el tuyo es privado y gratuito, hazlo público o arrastra la carpeta del proyecto a [Netlify Drop](https://app.netlify.com/drop).
2. **Instalar**: abre esa dirección en **Safari** del iPad → botón *Compartir* → **Añadir a pantalla de inicio**. Se abrirá a pantalla completa, como una app.
3. **Activar la IA**: en ⚙️ *Ajustes*, pega tu clave de la API de Claude (créala en [platform.claude.com](https://platform.claude.com/settings/keys)) y pulsa *Probar clave*. La clave se guarda solo en tu iPad.
   - Modelo por defecto: Claude Opus 5.5. Puedes cambiar a Sonnet 5.5 o Haiku 5.5 para que cada análisis salga más barato.
   - El análisis usa las herramientas de búsqueda y lectura web de Claude; si tu organización de la API las tiene desactivadas, actívalas en la consola de Anthropic.

## Estructura

```
index.html              interfaz
css/styles.css          estilos (modo claro/oscuro, adaptado a iPad)
js/app.js               lógica de la app, guardados y exportación
js/osm.js               búsqueda en OpenStreetMap (Nominatim + Overpass) y enlaces de Google/WhatsApp
js/ai.js                análisis con Claude (web_search + web_fetch)
js/pricing.js           estimación de precio por sector sin IA
js/vendor/anthropic-sdk.js  SDK oficial de Anthropic (v1.8.0) empaquetado para el navegador
sw.js, manifest.webmanifest, icons/   lo necesario para instalarla como app
```

Para probarla en un ordenador: `python3 -m http.server` en esta carpeta y abre `http://localhost:8000`.
