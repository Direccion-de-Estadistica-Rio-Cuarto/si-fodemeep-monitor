/**
 * Barrio oficial de cada institución — SI FoDeMEEP Río Cuarto.
 *
 * Regla: el barrio de una escuela es SIEMPRE el polígono de la capa «Barrios»
 * (datos/barrios-rio-cuarto.geojson, repositorio Mapas de la Dirección de Estadística)
 * en el que caen sus coordenadas. El barrio cargado en el padrón o en la planilla
 * se conserva sólo como referencia (barrioPadron) y no se usa.
 *
 *   · Institución con varias sedes/puntos: los barrios de cada punto, sin repetir,
 *     unidos con « | » (mismo formato que ya usaba el padrón).
 *   · Coordenadas fuera de todos los polígonos: sin barrio asignado ('').
 *   · Sin coordenadas: no hay polígono que consultar; queda el barrio del padrón.
 *
 * Lo usan la PWA (js/padron.js) y el Monitor (monitor/monitor.js), así que los dos
 * muestran, filtran y envían a la planilla el mismo barrio.
 */

const URL_BARRIOS = new URL('../datos/barrios-rio-cuarto.geojson', import.meta.url).href;
let _carga = null;

/** Descarga la capa una sola vez. Sin conexión la toma de la caché del Service Worker. */
export function cargarBarrios() {
  _carga = _carga || fetch(URL_BARRIOS)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(geo => { prepararIndice(geo); return geo; })
    .catch(() => { _carga = null; return null; }); // reintenta en el próximo pedido
  return _carga;
}

/** «Bo. Jardín Norte» → «Jardín Norte». Los sectores «S/D N.º …» quedan como están. */
export const nombreBarrio = nombre => String(nombre || '').replace(/^Bo\.\s+/, '').trim();

const INDICE = new WeakMap(); // geo → [{ nombre, caja, anillos }]

function prepararIndice(geo) {
  if (INDICE.has(geo)) return INDICE.get(geo);
  const lista = [];
  for (const f of geo?.features || []) {
    const g = f.geometry; if (!g) continue;
    const poligonos = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const anillos of poligonos) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of anillos[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      lista.push({ nombre: nombreBarrio(f.properties?.nombre), caja: [x0, y0, x1, y1], anillos });
    }
  }
  INDICE.set(geo, lista);
  return lista;
}

/** Punto en anillo (ray casting). x = longitud, y = latitud. */
function dentroDeAnillo(x, y, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Barrio del polígono que contiene [latitud, longitud], o null si cae fuera de todos. */
export function barrioEnPunto(geo, coordenada) {
  if (!geo || !Array.isArray(coordenada)) return null;
  const [lat, lng] = coordenada.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const p of prepararIndice(geo)) {
    const [x0, y0, x1, y1] = p.caja;
    if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
    if (dentroDeAnillo(lng, lat, p.anillos[0]) && !p.anillos.slice(1).some(h => dentroDeAnillo(lng, lat, h))) return p.nombre;
  }
  return null;
}

/** Barrio de una institución a partir de todas sus coordenadas (ver reglas arriba). */
export function barrioDeInstitucion(geo, inst) {
  const coords = (inst?.coordenadas || []).filter(c => Array.isArray(c) && c.length >= 2);
  if (!geo || !coords.length) return inst?.barrioPadron ?? inst?.barrio ?? '';
  return [...new Set(coords.map(c => barrioEnPunto(geo, c)).filter(Boolean))].join(' | ');
}

/** Barrios de una institución como lista («Banda Norte | Las Ferias» → ['Banda Norte', 'Las Ferias']). */
export const listaBarrios = barrio => String(barrio || '').split('|').map(b => b.trim()).filter(Boolean);

/** ¿La institución está en alguno de los barrios elegidos? (una escuela con sedes en varios barrios cuenta en cada uno). */
export const estaEnBarrio = (barrioInstitucion, elegido) => {
  const propios = listaBarrios(barrioInstitucion);
  return listaBarrios(elegido).some(b => propios.includes(b));
};

/** Copia del listado con el barrio del polígono. Es idempotente: se puede aplicar varias veces. */
export function asignarBarrios(instituciones, geo) {
  if (!geo || !Array.isArray(instituciones)) return instituciones;
  return instituciones.map(i => {
    const barrioPadron = i.barrioPadron ?? (i.barrio || '');
    return { ...i, barrioPadron, barrio: barrioDeInstitucion(geo, { ...i, barrioPadron }) };
  });
}
