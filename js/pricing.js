// Estimación orientativa de precios (sin IA) para el mercado español de pequeñas empresas.
// Se usa como referencia inmediata; el análisis con IA la afina negocio a negocio.

const TIERS = {
  hosteleria:   { venta: [600, 1400],  mant: [30, 60],  propuesta: "Web con carta digital, fotos, horarios, reservas y enlace a Google Maps" },
  comercio:     { venta: [700, 1600],  mant: [35, 70],  propuesta: "Web de escaparate con catálogo; opción de tienda online (+800–2.000 €)" },
  salud:        { venta: [900, 2000],  mant: [45, 90],  propuesta: "Web profesional con servicios, equipo, cita previa online y SEO local" },
  alojamiento:  { venta: [1200, 3000], mant: [60, 120], propuesta: "Web multidioma con galería y motor de reservas directo (menos comisión a Booking)" },
  profesionales:{ venta: [800, 1800],  mant: [40, 80],  propuesta: "Web corporativa con servicios, casos, formulario de contacto y blog" },
  oficios:      { venta: [500, 1100],  mant: [25, 50],  propuesta: "Web sencilla con servicios, zona de trabajo, fotos de trabajos y botón de llamada/WhatsApp" },
  ocio:         { venta: [800, 1800],  mant: [40, 80],  propuesta: "Web con horarios, tarifas, reservas o inscripción online" },
  servicios:    { venta: [600, 1400],  mant: [30, 60],  propuesta: "Web de presentación con servicios, contacto y SEO local" },
};

const round = (n) => Math.round(n / 50) * 50;

export function estimatePrice(b) {
  const tier = TIERS[b.category] || TIERS.servicios;
  let [vMin, vMax] = tier.venta;
  // Rediseño: ya existe contenido/dominio, algo menos de trabajo inicial.
  if (b.website) { vMin *= 0.9; vMax *= 0.9; }
  const venta = { min: round(vMin), max: round(vMax), recomendado: round((vMin + vMax) / 2) };
  const [mMin, mMax] = tier.mant;
  const mantenimiento = { min: mMin, max: mMax, recomendado: Math.round((mMin + mMax) / 2 / 5) * 5 };
  return { venta, mantenimiento, propuesta: tier.propuesta };
}

export const euro = (n) =>
  typeof n === "number" ? n.toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " €" : "—";
