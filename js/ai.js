// Análisis de un negocio con Claude: revisa su web (o confirma que no tiene),
// valora lo anticuada que está y propone precio de venta + mantenimiento.
import Anthropic from "./vendor/anthropic-sdk.js";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (mejor calidad)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (equilibrado)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (más barato)" },
];

const SYSTEM = `Eres un consultor de desarrollo web para pequeños negocios en España. Un freelance que crea webs con ayuda de IA te pide valorar si un negocio es buen cliente potencial.

Tu trabajo:
1. Si el negocio tiene web, ábrela con web_fetch y evalúa lo moderna que es: diseño (aspecto de los años 2000-2015, tablas, fuentes del sistema, Flash, imágenes pixeladas), si es adaptable a móvil (meta viewport, maquetación), HTTPS, año del copyright, tecnología (constructores antiguos, plantillas genéricas), velocidad aparente, SEO básico (title, description), y si tiene llamadas a la acción, reservas o tienda.
2. Si no consta web, usa web_search (como mucho 3 búsquedas) para comprobar si en realidad tiene web propia, o solo redes sociales / fichas de directorios. Busca también teléfono, email, Instagram o Facebook públicos.
3. Propón qué web le harías y estima un precio justo para el mercado español de 2026 para un freelance (no una agencia grande): precio de venta único y cuota mensual de mantenimiento (hosting, dominio, actualizaciones, copias de seguridad, pequeños cambios). Ten en cuenta el tipo de negocio, su tamaño aparente, la zona y las funcionalidades necesarias.
4. Redacta un mensaje breve, cercano y nada agresivo para contactar al negocio (WhatsApp o email), en español de España, mencionando algo concreto de su caso.

Responde SOLO con un objeto JSON válido (sin texto antes ni después, sin markdown) con exactamente esta forma:
{
  "tiene_web": boolean,
  "url_web": string | null,
  "estado_web": "sin_web" | "solo_redes" | "anticuada" | "mejorable" | "moderna",
  "puntuacion_modernidad": number | null,
  "problemas_detectados": string[],
  "propuesta": string,
  "funcionalidades": string[],
  "precio_venta": { "min": number, "max": number, "recomendado": number },
  "mantenimiento_mensual": { "min": number, "max": number, "recomendado": number },
  "justificacion_precio": string,
  "contacto_extra": { "telefono": string | null, "email": string | null, "instagram": string | null, "facebook": string | null, "otros": string | null },
  "prioridad": "alta" | "media" | "baja",
  "motivo_prioridad": string,
  "mensaje_contacto": string
}
"puntuacion_modernidad" va de 0 (muy anticuada) a 10 (moderna) o null si no hay web. Los precios en euros, sin IVA, números enteros. "prioridad" alta = sin web o web muy anticuada y negocio con capacidad de pago.`;

function businessPrompt(b) {
  const lines = [
    `Negocio: ${b.name}`,
    `Tipo: ${b.type}`,
    b.address && `Dirección: ${b.address}`,
    b.city && `Localidad: ${b.city}`,
    `Coordenadas: ${b.lat?.toFixed(5)}, ${b.lon?.toFixed(5)}`,
    b.website ? `Web registrada: ${b.website}` : "Web registrada: ninguna",
    b.phones?.length && `Teléfono: ${b.phones.join(", ")}`,
    b.email && `Email: ${b.email}`,
    b.instagram && `Instagram: ${b.instagram}`,
    b.facebook && `Facebook: ${b.facebook}`,
    b.hours && `Horario: ${b.hours}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("La IA no devolvió un resultado legible. Vuelve a intentarlo.");
  return JSON.parse(text.slice(start, end + 1));
}

export async function analyzeBusiness(b, { apiKey, model }) {
  if (!apiKey) throw new Error("Añade tu clave de la API de Claude en Ajustes para usar el análisis con IA.");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "ES", city: b.city || undefined } },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 30000 },
  ];

  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    tools,
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: businessPrompt(b) }],
  };
  // Si el modelo rechaza la petición, la API la reintenta en otro modelo (no disponible en Haiku).
  if (model !== "claude-haiku-5-5") {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  let response;
  try {
    // Las herramientas de servidor pueden pausar el turno: lo reenviamos hasta que termine.
    for (let i = 0; i < 4; i++) {
      response = await client.beta.messages.create(params);
      if (response.stop_reason !== "pause_turn") break;
      params.messages = [...params.messages, { role: "assistant", content: response.content }];
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("La clave de la API no es válida. Revísala en Ajustes.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error("Tu clave no tiene permiso para este modelo o para la búsqueda web (actívala en la consola de Anthropic).");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Demasiadas peticiones seguidas. Espera un minuto y repite.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Sin conexión con la API de Claude. Comprueba tu internet.");
    if (err instanceof Anthropic.APIError) throw new Error(`Error de la API de Claude (${err.status ?? "?"}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new Error("La IA no ha podido analizar este negocio.");
  const text = response.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const result = extractJson(text);
  result.analizado = new Date().toISOString();
  result.modelo = response.model;
  return result;
}

export async function testKey({ apiKey, model }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const r = await client.messages.create({
    model,
    max_tokens: 64,
    messages: [{ role: "user", content: "Responde solo: OK" }],
  });
  return r.content.some((c) => c.type === "text");
}
