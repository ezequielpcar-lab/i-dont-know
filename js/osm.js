// Búsqueda de negocios con datos abiertos de OpenStreetMap.
// - Nominatim: convierte la zona escrita (p. ej. "Ruzafa, Valencia") en coordenadas.
// - Overpass: obtiene los negocios con nombre dentro del radio elegido.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export async function geocode(zone) {
  const url = `${NOMINATIM}?format=jsonv2&countrycodes=es&limit=5&addressdetails=1&q=${encodeURIComponent(zone)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "es" } });
  if (!res.ok) throw new Error(`No se pudo localizar la zona (error ${res.status}).`);
  const data = await res.json();
  if (!data.length) throw new Error(`No encuentro "${zone}" en España. Prueba con "barrio, ciudad" o un código postal.`);
  return data.map((d) => ({
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    label: d.display_name,
  }));
}

const AMENITIES = [
  "restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "biergarten",
  "dentist", "clinic", "doctors", "pharmacy", "veterinary", "driving_school",
  "language_school", "music_school", "dancing_school", "kindergarten",
  "car_wash", "car_rental", "fuel", "nightclub",
];

function buildQuery(lat, lon, radius, categories) {
  const a = `(around:${radius},${lat},${lon})`;
  const parts = [];
  if (categories.includes("comercio")) parts.push(`nwr["name"]["shop"]${a};`);
  if (categories.includes("hosteleria") || categories.includes("salud") || categories.includes("servicios")) {
    parts.push(`nwr["name"]["amenity"~"^(${AMENITIES.join("|")})$"]${a};`);
  }
  if (categories.includes("salud")) parts.push(`nwr["name"]["healthcare"]${a};`);
  if (categories.includes("oficios")) parts.push(`nwr["name"]["craft"]${a};`);
  if (categories.includes("profesionales")) parts.push(`nwr["name"]["office"]${a};`);
  if (categories.includes("alojamiento")) parts.push(`nwr["name"]["tourism"~"^(hotel|guest_house|hostel|apartment|motel|camp_site)$"]${a};`);
  if (categories.includes("ocio")) parts.push(`nwr["name"]["leisure"~"^(fitness_centre|sports_centre|dance|escape_game)$"]${a};`);
  return `[out:json][timeout:60];(${parts.join("")});out center tags 800;`;
}

async function overpass(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) throw new Error(`Overpass respondió ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`El servidor de mapas no responde ahora mismo (${lastErr?.message}). Inténtalo en un minuto.`);
}

const first = (t, ...keys) => {
  for (const k of keys) if (t[k]) return t[k].split(";")[0].trim();
  return "";
};

function normalizeUrl(u) {
  if (!u) return "";
  u = u.trim();
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

function socialUrl(value, base) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return base + value.replace(/^@/, "");
}

export function categoryOf(t) {
  const amen = t.amenity || "";
  if (["restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "biergarten", "nightclub"].includes(amen)) return "hosteleria";
  if (t.healthcare || ["dentist", "clinic", "doctors", "pharmacy", "veterinary"].includes(amen)) return "salud";
  if (t.tourism) return "alojamiento";
  if (t.office) return "profesionales";
  if (t.craft || ["car_repair", "car_parts"].includes(t.shop)) return "oficios";
  if (t.leisure) return "ocio";
  if (t.shop) return "comercio";
  return "servicios";
}

const TYPE_LABELS = {
  restaurant: "Restaurante", cafe: "Cafetería", bar: "Bar", pub: "Pub", fast_food: "Comida rápida",
  ice_cream: "Heladería", dentist: "Dentista", clinic: "Clínica", doctors: "Consulta médica",
  pharmacy: "Farmacia", veterinary: "Veterinario", driving_school: "Autoescuela",
  language_school: "Academia de idiomas", music_school: "Escuela de música", dancing_school: "Escuela de baile",
  kindergarten: "Guardería", car_wash: "Lavado de coches", car_rental: "Alquiler de coches",
  hairdresser: "Peluquería", beauty: "Estética", bakery: "Panadería", butcher: "Carnicería",
  clothes: "Ropa", shoes: "Zapatería", florist: "Floristería", optician: "Óptica",
  car_repair: "Taller mecánico", hardware: "Ferretería", furniture: "Muebles", jewelry: "Joyería",
  convenience: "Alimentación", supermarket: "Supermercado", greengrocer: "Frutería", books: "Librería",
  pet: "Tienda de animales", travel_agency: "Agencia de viajes", estate_agent: "Inmobiliaria",
  lawyer: "Abogados", accountant: "Asesoría", insurance: "Seguros", architect: "Arquitectura",
  hotel: "Hotel", guest_house: "Casa rural / pensión", hostel: "Albergue", apartment: "Apartamentos",
  fitness_centre: "Gimnasio", sports_centre: "Centro deportivo", physiotherapist: "Fisioterapia",
  electrician: "Electricista", plumber: "Fontanero", carpenter: "Carpintería", photographer: "Fotografía",
  tattoo: "Tatuajes", massage: "Masajes", dry_cleaning: "Tintorería", laundry: "Lavandería",
  mobile_phone: "Telefonía", computer: "Informática", wine: "Vinoteca", deli: "Delicatessen",
  confectionery: "Pastelería", pastry: "Pastelería", gift: "Regalos", toys: "Juguetería",
  bicycle: "Bicicletas", kiosk: "Quiosco", tobacco: "Estanco", fuel: "Gasolinera",
};

export function typeLabel(t) {
  const raw = t.shop || t.amenity || t.craft || t.office || t.tourism || t.leisure || t.healthcare || "";
  if (TYPE_LABELS[raw]) return TYPE_LABELS[raw];
  if (!raw || raw === "yes") return "Negocio";
  const s = raw.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toBusiness(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const street = [first(t, "addr:street"), first(t, "addr:housenumber")].filter(Boolean).join(", ");
  const city = first(t, "addr:city", "addr:town", "addr:village", "addr:suburb");
  const address = [street, [first(t, "addr:postcode"), city].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const website = normalizeUrl(first(t, "website", "contact:website", "url"));
  const phones = [...new Set(
    ["phone", "contact:phone", "mobile", "contact:mobile"]
      .flatMap((k) => (t[k] ? t[k].split(";") : []))
      .map((p) => p.trim())
      .filter(Boolean)
  )];
  return {
    id: `${el.type}/${el.id}`,
    name: t.name,
    type: typeLabel(t),
    category: categoryOf(t),
    lat, lon,
    address,
    city,
    website,
    phones,
    email: first(t, "email", "contact:email"),
    facebook: socialUrl(first(t, "contact:facebook", "facebook"), "https://www.facebook.com/"),
    instagram: socialUrl(first(t, "contact:instagram", "instagram"), "https://www.instagram.com/"),
    hours: t.opening_hours || "",
    isChain: Boolean(t["brand:wikidata"] || t["brand"]),
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function searchBusinesses({ lat, lon, radius, categories }) {
  const data = await overpass(buildQuery(lat, lon, radius, categories));
  const seen = new Set();
  const list = [];
  for (const el of data.elements || []) {
    if (!el.tags?.name) continue;
    const b = toBusiness(el);
    const key = (b.name + "|" + b.address).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    b.distance = distanceKm(lat, lon, b.lat, b.lon);
    list.push(b);
  }
  list.sort((x, y) => x.distance - y.distance);
  return list;
}

// ---------- Enlaces útiles ----------

export function googleMapsUrl(b) {
  const q = [b.name, b.address || b.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || `${b.lat},${b.lon}`)}`;
}

export function googleSearchUrl(b) {
  const q = [b.name, b.city || b.address].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function whatsappUrl(phone, text = "") {
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = "34" + digits;
  // Solo móviles españoles (6xx / 7xx) tienen WhatsApp con seguridad.
  if (!/^34[67]\d{8}$/.test(digits)) return "";
  return `https://wa.me/${digits}${text ? "?text=" + encodeURIComponent(text) : ""}`;
}
