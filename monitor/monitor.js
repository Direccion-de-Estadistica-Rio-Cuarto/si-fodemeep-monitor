/**
 * Monitor Ejecutivo — SI FoDeMEEP Río Cuarto.
 * Dirección de Estadística, Control de Calidad y Procesos.
 *
 * Lee la planilla central a través de la aplicación web de Apps Script (accion=monitor)
 * y presenta: cobertura del padrón, IES por institución, Alertas Rojas, incidencias por
 * rubro y jurisdicción, mapa territorial, seguimiento de la gestión de cada incidencia y
 * evidencias fotográficas de cada institución (guardadas en Google Drive por Apps Script).
 */
import { icono } from '../js/iconos.js';
import { DIMENSIONES, SECCIONES } from '../js/catalogo.js';
import { generarDatosEjemplo } from './ejemplo.js';
import { cargarBarrios, asignarBarrios, listaBarrios, estaEnBarrio } from '../js/barrios.js';

const URL_PREDETERMINADA = 'https://script.google.com/macros/s/AKfycbxxL7HoQ5SesZ1RhalhHOz2o7-ShuaCBNu2tF4JFnfhnmN97Hdyp7nrg5tCrmEgGZBS/exec';
const CLAVE_CONFIG = 'fodemeep-monitor-config';
const ESTADOS_GESTION = ['Pendiente', 'Programada', 'En ejecución', 'Resuelta', 'Derivada a Provincia'];
const CLASES = {
  optimo: 'Óptimo', bueno: 'Bueno', regular: 'Regular', critico: 'Crítico', roja: 'Alerta Roja', curso: 'En curso', pendiente: 'Pendiente'
};
const ORDEN_CLASES = ['optimo', 'bueno', 'regular', 'critico', 'roja', 'curso', 'pendiente'];
const COL_DIM = { D1: 'D1_seguridad_critica', D2: 'D2_agua_saneamiento', D3: 'D3_estructura_cubiertas', D4: 'D4_climatizacion', D5: 'D5_alimentacion_cocina', D6: 'D6_accesibilidad', D7: 'D7_entorno_exterior' };
const ORDEN_CRIT = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };
const JUR = { FoDeMEEP: 'FoDeMEEP', PROVINCIA_MAYOR: 'Provincia' };
const VISTAS = [['panorama', 'Panorama'], ['instituciones', 'Instituciones'], ['incidencias', 'Plan de intervención'], ['evidencias', 'Evidencias']];
const MIME_ADMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const LADO_MAXIMO = 1920;      // px: las fotos se reducen antes de subir (también quita los metadatos EXIF y la ubicación GPS)
const CALIDAD_JPEG = 0.85;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = n => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
const fecha = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const marca = r => { const d = new Date(r.fecha_finalizacion || r.fecha_recepcion || 0); return isNaN(d) ? 0 : d.getTime(); };
const claseDe = etiqueta => ({ 'Óptimo': 'optimo', 'Bueno': 'bueno', 'Regular': 'regular', 'Crítico': 'critico' }[etiqueta] || 'critico');

/* ================= Configuración ================= */

function leerConfig() {
  try { return { url: URL_PREDETERMINADA, token: '', ejemplo: false, ...JSON.parse(localStorage.getItem(CLAVE_CONFIG) || '{}') }; }
  catch { return { url: URL_PREDETERMINADA, token: '', ejemplo: false }; }
}
function guardarConfig(c) { try { localStorage.setItem(CLAVE_CONFIG, JSON.stringify(c)); } catch { /* sin almacenamiento */ } }

/* ================= Estado ================= */

const st = {
  config: leerConfig(), datos: null, m: null, cargando: false, error: '',
  filtros: { barrio: '', nivel: '', texto: '' },
  inc: { rubro: '', criticidad: '', jurisdiccion: '', gestion: 'abiertas', soloKS: false },
  orden: { col: 'ies', dir: 1 }, seleccion: null, mapa: null, verBarrios: true,
  evid: { cue: null, rel: '', preg: '', desc: '', buscar: '', cola: [] },
  imagenes: new Map()   // id de evidencia → data: URL de la miniatura ('cargando' | 'error' mientras tanto)
};

/* ================= Datos ================= */

async function cargar() {
  st.cargando = true; st.error = ''; pintar();
  try {
    if (st.config.ejemplo) st.datos = generarDatosEjemplo();
    else {
      if (!st.config.url || !st.config.token) throw new Error('Configure la URL y la clave de acceso.');
      const r = await fetch(`${st.config.url}?accion=monitor&token=${encodeURIComponent(st.config.token)}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'La planilla rechazó la consulta.');
      st.datos = j;
    }
    st.geoBarrios = await cargarBarrios(); // barrio oficial = polígono donde cae cada escuela
    st.m = construirModelo(st.datos);
  } catch (e) {
    st.error = e.message.includes('Failed to fetch') ? 'No se pudo conectar con la planilla. Verifique la conexión a internet y la URL.' : e.message;
  }
  st.cargando = false; pintar();
}

function construirModelo(d) {
  const relPorCue = new Map();
  for (const r of d.relevamientos || []) {
    const cue = String(r.cue_base || ''); if (!cue) continue;
    (relPorCue.get(cue) || relPorCue.set(cue, []).get(cue)).push(r);
  }
  for (const l of relPorCue.values()) l.sort((a, b) => marca(b) - marca(a));
  const vigentes = new Set([...relPorCue.values()].map(l => l[0].id_relevamiento));

  // El barrio de cada escuela es el del polígono de la capa «Barrios» donde cae (js/barrios.js),
  // aunque la planilla o el padrón digan otro.
  const escuelas = asignarBarrios(d.instituciones || [], st.geoBarrios).map(i => {
    const rels = relPorCue.get(i.cue) || [];
    const ultimo = rels[0] || null;
    const ks = ultimo ? Number(ultimo.cant_kill_switch) || 0 : 0;
    const clase = ultimo ? (ks ? 'roja' : claseDe(ultimo.clasificacion)) : (i.estadoServidor?.estado === 'En curso' ? 'curso' : 'pendiente');
    return { ...i, rels, ultimo, ks, clase, ies: ultimo ? Number(ultimo.ies) : null, incidencias: [] };
  });
  const porCue = new Map(escuelas.map(e => [e.cue, e]));

  const incidencias = (d.incidencias || []).filter(x => vigentes.has(x.id_relevamiento)).map(x => {
    const e = porCue.get(String(x.cue_base));
    const item = { ...x, barrio: e ? e.barrio : x.barrio, escuela: e, puntos: Number(x.puntos) || 0, ks: x.kill_switch === 'SI', estado_gestion: x.estado_gestion || 'Pendiente' };
    e?.incidencias.push(item);
    return item;
  });
  for (const e of escuelas) { e.abiertas = e.incidencias.filter(x => x.estado_gestion !== 'Resuelta'); e.evidencias = []; }
  for (const ev of d.evidencias || []) porCue.get(String(ev.cue_base))?.evidencias.push(ev);
  for (const e of escuelas) e.evidencias.sort((a, b) => new Date(b.fecha_carga) - new Date(a.fecha_carga));
  return { escuelas, incidencias, porCue };
}

function escuelasFiltradas() {
  const { barrio, nivel, texto } = st.filtros;
  const t = sinTildes(texto).trim();
  return st.m.escuelas.filter(e => (!barrio || estaEnBarrio(e.barrio, barrio)) && (!nivel || e.niveles.includes(nivel)) &&
    (!t || t.split(/\s+/).every(w => sinTildes(`${e.nombre} ${e.cue} ${e.barrio} ${e.direcciones.join(' ')}`).includes(w))));
}

/* ================= Componentes ================= */

const pill = clase => `<span class="etiqueta-clase p-${clase}">${clase === 'roja' ? icono('Siren') : ''}${CLASES[clase]}</span>`;
const barraHtml = (valor, clase = 'serie', tip = '') => `<div class="mini-barra" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="b-${clase}" style="width:${Math.max(0, Math.min(100, valor || 0))}%"></div></div>`;

function kpis(esc_) {
  const total = esc_.length;
  const rel = esc_.filter(e => e.ultimo);
  const curso = esc_.filter(e => e.clase === 'curso').length;
  const prom = rel.length ? rel.reduce((a, e) => a + e.ies, 0) / rel.length : null;
  const rojas = rel.filter(e => e.ks);
  const ab = rel.flatMap(e => e.abiertas);
  const abF = ab.filter(x => x.jurisdiccion === 'FoDeMEEP').length;
  return `<section class="indicadores" aria-label="Indicadores principales">
    <article class="kpi"><p class="etiqueta">Cobertura del padrón</p>
      <p class="valor">${rel.length}<small> de ${total}</small></p>
      <div class="kpi-barra" data-tip="${rel.length} relevadas · ${curso} en curso · ${total - rel.length - curso} pendientes"><div class="b-relevada" style="width:${total ? 100 * rel.length / total : 0}%"></div><div class="b-curso" style="width:${total ? 100 * curso / total : 0}%"></div></div>
      <p class="detalle">${total ? Math.round(100 * rel.length / total) : 0}% relevadas · ${curso} en curso</p></article>
    <article class="kpi"><p class="etiqueta">IES promedio</p>
      <p class="valor">${prom == null ? '—' : Math.round(prom)}<small> / 100</small></p>
      <p class="detalle">${rel.length ? `Último relevamiento de ${rel.length} institución${rel.length > 1 ? 'es' : ''}` : 'Sin relevamientos'}</p></article>
    <article class="kpi kpi-roja ${rojas.length ? 'alerta-roja' : ''}"><p class="etiqueta">${icono('Siren')} Alerta Roja</p>
      <p class="valor">${rojas.length}<small> escuela${rojas.length === 1 ? '' : 's'}</small></p>
      <p class="detalle">${rojas.reduce((a, e) => a + e.ks, 0)} Kill-Switch activos · intervención inmediata</p></article>
    <article class="kpi"><p class="etiqueta">Incidencias abiertas</p>
      <p class="valor">${ab.length}</p>
      <p class="detalle"><i class="dot d-fodemeep"></i>FoDeMEEP ${abF} · <i class="dot d-provincia"></i>Provincia ${ab.length - abF}</p></article>
  </section>`;
}

function distribucion(esc_) {
  const n = esc_.length || 1;
  const c = Object.fromEntries(ORDEN_CLASES.map(k => [k, esc_.filter(e => e.clase === k).length]));
  return `<article class="panel">
    <header><h3>Estado de las instituciones</h3><span class="nota">Clasificación del último relevamiento</span></header>
    <div class="segmentos">${ORDEN_CLASES.filter(k => c[k]).map(k => `<div class="seg b-${k}" style="flex:${c[k]}" data-tip="${CLASES[k]}: ${c[k]} (${Math.round(100 * c[k] / n)}%)"></div>`).join('')}</div>
    <ul class="leyenda">${ORDEN_CLASES.map(k => `<li><i class="b-${k}"></i>${CLASES[k]}<b>${c[k]}</b></li>`).join('')}</ul>
  </article>`;
}

function rubros(esc_) {
  const ab = esc_.flatMap(e => e.abiertas);
  const g = {};
  for (const x of ab) { const r = g[x.tipo_incidencia] || (g[x.tipo_incidencia] = { F: 0, P: 0 }); x.jurisdiccion === 'FoDeMEEP' ? r.F++ : r.P++; }
  const filas = Object.entries(g).map(([t, v]) => ({ t, ...v, total: v.F + v.P })).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...filas.map(f => f.total));
  return `<article class="panel">
    <header><h3>Incidencias abiertas por rubro</h3><span class="nota">Último relevamiento de cada institución · sin resueltas</span></header>
    <ul class="leyenda chica"><li><i class="d-fodemeep"></i>FoDeMEEP (mantenimiento municipal)</li><li><i class="d-provincia"></i>Provincia (obra mayor)</li></ul>
    ${filas.length ? `<div class="hbars">${filas.map(f => `
      <button class="hbar" data-rubro="${esc(f.t)}" data-tip="${esc(f.t)}: ${f.total} abiertas · FoDeMEEP ${f.F} · Provincia ${f.P}">
        <span class="hb-l">${esc(f.t.toLowerCase())}</span>
        <span class="hb-p"><span class="hb-track" style="width:${100 * f.total / max}%">${f.F ? `<span class="d-fodemeep" style="flex:${f.F}"></span>` : ''}${f.P ? `<span class="d-provincia" style="flex:${f.P}"></span>` : ''}</span><b>${f.total}</b></span>
      </button>`).join('')}</div>` : '<p class="vacio">No hay incidencias abiertas.</p>'}
  </article>`;
}

function barrios(esc_) {
  const g = {};
  // Una escuela con sedes en varios barrios suma en cada uno de ellos.
  for (const e of esc_.filter(x => x.ultimo)) for (const k of (listaBarrios(e.barrio).length ? listaBarrios(e.barrio) : ['Sin barrio asignado'])) (g[k] || (g[k] = [])).push(e.ies);
  const filas = Object.entries(g).map(([b, l]) => ({ b, n: l.length, p: l.reduce((a, x) => a + x, 0) / l.length })).sort((a, b) => a.p - b.p);
  return `<article class="panel">
    <header><h3>IES promedio por barrio</h3><span class="nota">De menor a mayor · n = instituciones relevadas</span></header>
    ${filas.length ? `<div class="hbars">${filas.map(f => `
      <button class="hbar" data-barrio="${esc(f.b === 'Sin barrio asignado' ? '' : f.b)}" data-tip="${esc(f.b)}: IES promedio ${fmt(f.p)} · ${f.n} institución${f.n > 1 ? 'es' : ''}">
        <span class="hb-l">${esc(f.b)} <small>n=${f.n}</small></span>
        <span class="hb-p"><span class="hb-track" style="width:${f.p}%"><span class="serie" style="flex:1"></span></span><b>${Math.round(f.p)}</b></span>
      </button>`).join('')}</div>` : '<p class="vacio">Sin relevamientos.</p>'}
  </article>`;
}

function dimensionesProm(esc_) {
  const rel = esc_.filter(e => e.ultimo);
  return `<article class="panel">
    <header><h3>Subíndices promedio</h3><span class="nota">Sólo dimensiones completas · peso en el IES</span></header>
    <div class="hbars">${DIMENSIONES.map(d => {
      const v = rel.map(e => e.ultimo[COL_DIM[d.id]]).filter(x => x !== 'Incompleta' && x !== '' && x != null).map(Number);
      const p = v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
      return `<div class="hbar estatico" data-tip="${esc(d.nombre)}: promedio ${fmt(p)} sobre ${v.length} relevamientos · peso ${d.peso}%">
        <span class="hb-l">${esc(d.nombre)} <small>${d.peso}%</small></span>
        <span class="hb-p"><span class="hb-track" style="width:${p ?? 0}%"><span class="serie" style="flex:1"></span></span><b>${p == null ? '—' : Math.round(p)}</b></span></div>`;
    }).join('')}</div>
  </article>`;
}

function prioridades(esc_) {
  const rojas = esc_.filter(e => e.ks).sort((a, b) => b.ks - a.ks || a.ies - b.ies);
  const peores = esc_.filter(e => e.ultimo && !e.ks).sort((a, b) => a.ies - b.ies).slice(0, 8);
  const fila = e => `<li><button class="fila-esc" data-cue="${e.cue}">
      <span class="fe-n"><strong>${esc(e.nombre)}</strong><small>${esc(e.barrio || 'Sin barrio')} · ${fecha(e.ultimo.fecha_finalizacion)}</small></span>
      ${e.ks ? `<span class="fe-ks texto-ks">${esc(String(e.ultimo.motivos_kill_switch).split(' | ')[0])}${e.ks > 1 ? ` <small>+${e.ks - 1}</small>` : ''}</span>` : ''}
      <span class="numero-ies c-${e.clase}">${e.ies}</span></button></li>`;
  return `<article class="panel tarjeta-prioridad">
    <header><h3>${icono('Siren')} Alerta Roja</h3><span class="nota">Riesgo severo en gas, electricidad, estructura o agua</span></header>
    ${rojas.length ? `<ul class="lista-esc">${rojas.map(fila).join('')}</ul>` : '<p class="vacio">Ninguna institución con Kill-Switch activo.</p>'}
    <header class="sep"><h3>Menor IES sin Alerta Roja</h3></header>
    ${peores.length ? `<ul class="lista-esc">${peores.map(fila).join('')}</ul>` : '<p class="vacio">Sin relevamientos.</p>'}
  </article>`;
}

/* ================= Vistas ================= */

function vistaPanorama() {
  const e = escuelasFiltradas();
  return `${kpis(e)}
    <div class="grilla g-2">
      <div class="col">${distribucion(e)}${prioridades(e)}</div>
      <article class="panel tarjeta-mapa"><header class="cab-mapa"><div><h3>Mapa territorial</h3><span class="nota">Color según clasificación · tocar un punto para ver la ficha</span></div>
        <label class="chk"><input type="checkbox" id="ver-barrios" ${st.verBarrios ? 'checked' : ''}> Barrios</label></header>
        <div id="mapa" role="region" aria-label="Mapa de instituciones"></div>
        <ul class="leyenda chica">${ORDEN_CLASES.map(k => `<li><i class="b-${k} ${k === 'pendiente' ? 'hueco' : ''}"></i>${CLASES[k]}</li>`).join('')}${st.verBarrios ? '<li><i class="limite-barrio"></i>Límite de barrio</li>' : ''}</ul></article>
    </div>
    <div class="grilla g-3">${rubros(e)}${barrios(e)}${dimensionesProm(e)}</div>`;
}

function vistaInstituciones() {
  const { col, dir } = st.orden;
  const val = e => ({ nombre: sinTildes(e.nombre), barrio: sinTildes(e.barrio || 'zzz'), ies: e.ies ?? 999, ks: -e.ks, abiertas: -e.abiertas.length, fecha: -(e.ultimo ? marca(e.ultimo) : 0) }[col]);
  const lista = escuelasFiltradas().sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const th = (c, t) => `<th><button data-orden="${c}" class="${col === c ? 'activo' : ''}">${t}${col === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  return `<article class="panel tabla-tarjeta">
    <header><h3>Instituciones <span class="cuenta">${lista.length}</span></h3><span class="nota">Tocar una fila para ver la ficha completa</span></header>
    <div class="tabla-scroll"><table class="tabla">
      <thead><tr>${th('nombre', 'Institución')}${th('barrio', 'Barrio')}<th>Niveles</th><th>Estado</th>${th('ies', 'IES')}${th('ks', 'Kill-Switch')}${th('abiertas', 'Incid. abiertas')}${th('fecha', 'Último relevamiento')}</tr></thead>
      <tbody>${lista.map(e => `<tr data-cue="${e.cue}" tabindex="0">
        <td><strong>${esc(e.nombre)}</strong><small>CUE ${e.cue}</small></td>
        <td>${esc(e.barrio || '—')}</td>
        <td class="niv">${e.niveles.map(n => `<span>${esc(n)}</span>`).join('')}</td>
        <td>${pill(e.clase)}</td>
        <td class="num">${e.ies ?? '—'}</td>
        <td class="num">${e.ks ? `<span class="texto-ks">${icono('Siren')} ${e.ks}</span>` : '—'}</td>
        <td class="num">${e.ultimo ? `${e.abiertas.length} <small>${e.abiertas.filter(x => x.jurisdiccion === 'FoDeMEEP').length} F · ${e.abiertas.filter(x => x.jurisdiccion !== 'FoDeMEEP').length} P</small>` : '—'}</td>
        <td>${e.ultimo ? `${fecha(e.ultimo.fecha_finalizacion)}<small>${esc(e.ultimo.tecnico || '')}</small>` : e.clase === 'curso' ? `<small>${esc(e.estadoServidor?.tecnico || 'En curso')}</small>` : '—'}</td>
      </tr>`).join('')}</tbody></table></div></article>`;
}

function incidenciasFiltradas() {
  const cues = new Set(escuelasFiltradas().map(e => e.cue));
  const f = st.inc;
  return st.m.incidencias.filter(x => cues.has(String(x.cue_base)) &&
    (!f.rubro || x.tipo_incidencia === f.rubro) && (!f.criticidad || x.criticidad === f.criticidad) &&
    (!f.jurisdiccion || x.jurisdiccion === f.jurisdiccion) && (!f.soloKS || x.ks) &&
    (f.gestion === '' || (f.gestion === 'abiertas' ? x.estado_gestion !== 'Resuelta' : x.estado_gestion === f.gestion)))
    .sort((a, b) => (b.ks - a.ks) || (ORDEN_CRIT[a.criticidad] - ORDEN_CRIT[b.criticidad]) || (b.puntos - a.puntos) || ((a.escuela?.ies ?? 999) - (b.escuela?.ies ?? 999)));
}

function selectorGestion(x) {
  if (!st.datos.puedeEditar) return `<span class="g-est g-${sinTildes(x.estado_gestion).replace(/\s+/g, '-')}">${esc(x.estado_gestion)}</span>`;
  return `<select class="g-sel" data-rel="${esc(x.id_relevamiento)}" data-preg="${x.id_pregunta}" aria-label="Estado de gestión">${ESTADOS_GESTION.map(s => `<option ${s === x.estado_gestion ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
}

function vistaIncidencias() {
  const lista = incidenciasFiltradas();
  const todas = st.m.incidencias.filter(x => escuelasFiltradas().some(e => e.cue === String(x.cue_base)));
  const rubrosDisp = [...new Set(st.m.incidencias.map(x => x.tipo_incidencia))].sort();
  const f = st.inc;
  const conteo = s => todas.filter(x => x.estado_gestion === s).length;
  const pts = lista.reduce((a, x) => a + x.puntos, 0);
  return `<section class="resumen-gestion">${ESTADOS_GESTION.map(s => `<button class="rg ${f.gestion === s ? 'activo' : ''}" data-gestion="${s}"><b>${conteo(s)}</b><span>${s}</span></button>`).join('')}
      <button class="rg ${f.gestion === 'abiertas' ? 'activo' : ''}" data-gestion="abiertas"><b>${todas.filter(x => x.estado_gestion !== 'Resuelta').length}</b><span>Todas las abiertas</span></button></section>
    <article class="panel tabla-tarjeta">
      <header class="cab-filtros"><div><h3>Plan de intervención <span class="cuenta">${lista.length}</span></h3><span class="nota">Orden de prioridad: Kill-Switch, criticidad, puntos de impacto · ${pts} puntos en total</span></div>
        <div class="filtros-inc">
          <select id="fi-rubro" aria-label="Rubro"><option value="">Todos los rubros</option>${rubrosDisp.map(r => `<option ${f.rubro === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
          <select id="fi-crit" aria-label="Criticidad"><option value="">Toda criticidad</option>${Object.keys(ORDEN_CRIT).map(c => `<option ${f.criticidad === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <select id="fi-jur" aria-label="Jurisdicción"><option value="">Ambas jurisdicciones</option><option value="FoDeMEEP" ${f.jurisdiccion === 'FoDeMEEP' ? 'selected' : ''}>FoDeMEEP</option><option value="PROVINCIA_MAYOR" ${f.jurisdiccion === 'PROVINCIA_MAYOR' ? 'selected' : ''}>Provincia</option></select>
          <label class="chk"><input type="checkbox" id="fi-ks" ${f.soloKS ? 'checked' : ''}> Sólo Kill-Switch</label>
          <button class="boton boton--secundario boton--chico" id="exportar">${icono('Download')} Exportar CSV</button>
        </div></header>
      <div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Institución</th><th>#</th><th>Rubro</th><th>Criticidad</th><th>Jurisdicción</th><th class="num">Pts</th><th>Hallazgo</th><th>Gestión</th></tr></thead>
        <tbody>${lista.slice(0, 400).map(x => `<tr class="${x.ks ? 'fila-ks' : ''}">
          <td><button class="link" data-cue="${x.cue_base}">${esc(x.establecimiento)}</button><small>${esc(x.barrio || '')}</small></td>
          <td class="num">${x.id_pregunta}</td>
          <td>${esc(x.tipo_incidencia)}</td>
          <td><span class="crit c-${x.criticidad}">${x.criticidad}</span></td>
          <td><span class="jur"><i class="dot d-${x.jurisdiccion === 'FoDeMEEP' ? 'fodemeep' : 'provincia'}"></i>${JUR[x.jurisdiccion] || esc(x.jurisdiccion)}</span></td>
          <td class="num">${x.puntos}</td>
          <td>${x.ks ? `<span class="texto-ks" title="Kill-Switch">${icono('Siren')}</span> ` : ''}${esc(x.descripcion)}${x.observacion_auditor ? `<small class="obs-aud">${icono('MessageSquareText')} ${esc(x.observacion_auditor)}</small>` : ''}</td>
          <td>${selectorGestion(x)}</td></tr>`).join('')}</tbody></table>
        ${lista.length > 400 ? `<p class="vacio">Se muestran las primeras 400 de ${lista.length}. Use los filtros o exporte el CSV.</p>` : ''}
        ${!lista.length ? '<p class="vacio">No hay incidencias con esos filtros.</p>' : ''}</div></article>`;
}

/* ================= Ficha de institución ================= */

function ficha(e) {
  const u = e.ultimo;
  const hist = e.rels.slice().reverse();
  return `<div class="ficha-cab">
      <div><small>CUE ${e.cue} · ${esc(e.barrio || 'Sin barrio asignado')}</small><h2>${esc(e.nombre)}</h2>
        <p>${esc(u?.sede_relevada || e.direcciones[0] || 'Sin dirección registrada')}</p>
        <div class="niv">${e.niveles.map(n => `<span>${esc(n)}</span>`).join('')}</div></div>
      <button class="btn-ico" id="cerrar-ficha" aria-label="Cerrar">${icono('X')}</button></div>
    ${!u ? `<div class="ficha-vacia">${pill(e.clase)}<p>${e.clase === 'curso' ? `Relevamiento en curso${e.estadoServidor?.tecnico ? ` por ${esc(e.estadoServidor.tecnico)}` : ''}.` : 'Todavía no fue relevada.'}</p></div>` : `
    <section class="ficha-ies c-${e.clase}">
      <div><span>IES</span><b>${u.ies}</b><small>/ 100</small></div>
      <div>${pill(e.clase)}<p>${fecha(u.fecha_finalizacion)} · ${esc(u.tecnico || '')}</p>
        ${e.ks ? `<p>Puntaje base ${fmt(u.ies_base)} × multiplicador ${Number(u.multiplicador_kill_switch).toLocaleString('es-AR', { maximumFractionDigits: 4 })}</p>` : ''}
        ${Number(u.dimensiones_completas) < 7 ? `<p class="aviso">${u.dimensiones_completas} de 7 dimensiones completas</p>` : ''}</div>
    </section>
    ${e.ks ? `<section class="ficha-ks alerta-roja"><h3>${icono('Siren')} Kill-Switch activos</h3><ul>${String(u.motivos_kill_switch).split(' | ').map(m => `<li>${esc(m)}</li>`).join('')}</ul></section>` : ''}
    <section><h3>Subíndices</h3><div class="hbars">${DIMENSIONES.map(d => { const v = u[COL_DIM[d.id]]; const ok = v !== 'Incompleta' && v !== '' && v != null;
      return `<div class="hbar estatico"><span class="hb-l">${esc(d.nombre)} <small>${d.peso}%</small></span><span class="hb-p"><span class="hb-track" style="width:${ok ? v : 0}%"><span class="serie" style="flex:1"></span></span><b>${ok ? v : 'Incompleta'}</b></span></div>`; }).join('')}</div></section>
    ${hist.length > 1 ? `<section><h3>Evolución del IES</h3><ol class="historial">${hist.map(r => `<li><span>${fecha(r.fecha_finalizacion)}</span>${barraHtml(r.ies, claseDe(r.clasificacion), `IES ${r.ies} · ${r.clasificacion}`)}<b>${r.ies}</b></li>`).join('')}</ol></section>` : ''}
    <section><h3>Incidencias del último relevamiento <span class="cuenta">${e.incidencias.length}</span></h3>
      ${e.incidencias.length ? `<ul class="ficha-inc">${e.incidencias.slice().sort((a, b) => (b.ks - a.ks) || ORDEN_CRIT[a.criticidad] - ORDEN_CRIT[b.criticidad]).map(x => `<li class="${x.ks ? 'fila-ks' : ''}">
        <div><span class="crit c-${x.criticidad}">${x.criticidad}</span> <b>${esc(x.tipo_incidencia)}</b> <span class="jur"><i class="dot d-${x.jurisdiccion === 'FoDeMEEP' ? 'fodemeep' : 'provincia'}"></i>${JUR[x.jurisdiccion]}</span> <small>#${x.id_pregunta} · ${x.puntos} pts</small></div>
        <p>${x.ks ? `${icono('Siren')} ` : ''}${esc(x.descripcion)}</p>${x.observacion_auditor ? `<p class="obs-aud">${icono('MessageSquareText')} <span>Observación del auditor: ${esc(x.observacion_auditor)}</span></p>` : ''}${selectorGestion(x)}</li>`).join('')}</ul>` : '<p class="vacio">Sin incidencias.</p>'}</section>`}
    ${seccionEvidenciasFicha(e)}`;
}

/* ================= Evidencias fotográficas ================= */

const fechaHora = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

function miniatura(ev, clase = '') {
  const src = st.imagenes.get(ev.id_evidencia);
  const lista = src && src !== 'cargando' && src !== 'error';
  const alt = `Evidencia de ${ev.establecimiento || 'la institución'}${ev.descripcion ? `: ${ev.descripcion}` : ''}`;
  return `<button class="evid-mini ${clase}" data-ver-evid="${esc(ev.id_evidencia)}" aria-label="Ampliar: ${esc(alt)}">
      ${lista ? `<img src="${src}" alt="${esc(alt)}" loading="lazy">` : `<span class="evid-espera" data-evid-id="${esc(ev.id_evidencia)}">${icono(src === 'error' ? 'TriangleAlert' : 'Image')}<small>${src === 'error' ? 'Sin vista previa' : 'Cargando…'}</small></span>`}
    </button>`;
}

function seccionEvidenciasFicha(e) {
  const n = e.evidencias.length;
  return `<section class="ficha-evid"><h3>${icono('Camera')} Evidencias fotográficas <span class="cuenta">${n}</span></h3>
    ${n ? `<div class="evid-grilla chica">${e.evidencias.slice(0, 6).map(ev => miniatura(ev)).join('')}</div>` : '<p class="vacio">Todavía no hay fotos cargadas para esta institución.</p>'}
    <button class="boton boton--secundario boton--chico" data-ir-evid="${e.cue}">${icono(st.datos.puedeEditar ? 'Upload' : 'Image')} ${st.datos.puedeEditar ? 'Cargar y ver evidencias' : 'Ver todas las evidencias'}</button>
  </section>`;
}

function vistaEvidencias() {
  const lista = escuelasFiltradas().filter(e => !st.evid.buscar || sinTildes(`${e.nombre} ${e.cue}`).includes(sinTildes(st.evid.buscar)))
    .sort((a, b) => (b.evidencias.length - a.evidencias.length) || a.nombre.localeCompare(b.nombre, 'es'));
  const total = escuelasFiltradas().reduce((a, e) => a + e.evidencias.length, 0);
  const conFotos = escuelasFiltradas().filter(e => e.evidencias.length).length;
  const sel = st.evid.cue && st.m.porCue.get(st.evid.cue);
  return `<div class="grilla g-evid">
    <article class="panel evid-lista">
      <header><h3>Instituciones</h3><span class="nota">${total} foto${total === 1 ? '' : 's'} en ${conFotos} institución${conFotos === 1 ? '' : 'es'}</span></header>
      <label class="oculto" for="evid-buscar">Buscar institución</label>
      <input id="evid-buscar" type="search" placeholder="Buscar por nombre o CUE" value="${esc(st.evid.buscar)}" autocomplete="off">
      <ul class="lista-esc">${lista.map(e => `<li><button class="fila-esc ${st.evid.cue === e.cue ? 'activa' : ''}" data-evid-cue="${e.cue}" aria-current="${st.evid.cue === e.cue}">
        <span class="fe-n"><strong>${esc(e.nombre)}</strong><small>CUE ${e.cue} · ${esc(e.barrio || 'Sin barrio')}</small></span>
        <span class="cuenta" aria-label="${e.evidencias.length} fotos">${e.evidencias.length}</span></button></li>`).join('') || '<li class="vacio">Ninguna institución con esos filtros.</li>'}</ul>
    </article>
    <div class="col">${sel ? panelEvidencias(sel) : `<article class="panel evid-vacio">${icono('Camera', 'grande')}<h3>Elegí una institución</h3><p class="nota">Las fotos de campo quedan asignadas a la institución en su carpeta de Google Drive y se pueden vincular a un relevamiento y a una pregunta del formulario.</p></article>`}</div>
  </div>`;
}

function panelEvidencias(e) {
  const puede = st.datos.puedeEditar;
  const rels = e.rels;
  const relSel = st.evid.rel === '' && rels[0] ? rels[0].id_relevamiento : st.evid.rel;
  const incidencias = (st.datos.incidencias || []).filter(x => x.id_relevamiento === relSel);
  const cola = st.evid.cola.filter(c => c.cue === e.cue);
  return `<article class="panel">
      <header class="evid-cab"><div><h3>${esc(e.nombre)}</h3><span class="nota">CUE ${e.cue} · ${esc(e.barrio || 'Sin barrio asignado')} · ${e.evidencias.length} foto${e.evidencias.length === 1 ? '' : 's'}</span></div>
        <button class="boton boton--sutil boton--chico" data-cue="${e.cue}">${icono('FileText')} Ver ficha</button></header>
      ${puede ? `<form class="evid-form" id="evid-form" onsubmit="return false">
        <div class="evid-campos">
          <div><label for="evid-rel">Relevamiento</label>
            <select id="evid-rel"><option value="__ninguno" ${relSel === '__ninguno' ? 'selected' : ''}>Sin vincular a un relevamiento</option>
              ${rels.map(r => `<option value="${esc(r.id_relevamiento)}" ${r.id_relevamiento === relSel ? 'selected' : ''}>${fecha(r.fecha_finalizacion)} · ${esc(r.tecnico || 'sin técnico')} · IES ${r.ies}</option>`).join('')}</select></div>
          <div><label for="evid-preg">Pregunta o hallazgo (opcional)</label>
            <select id="evid-preg"><option value="">Vista general de la institución</option>
              ${incidencias.length ? `<optgroup label="Incidencias de ese relevamiento">${incidencias.map(x => `<option value="${x.id_pregunta}" ${String(st.evid.preg) === String(x.id_pregunta) ? 'selected' : ''}>#${x.id_pregunta} · ${esc(x.tipo_incidencia)} · ${esc(String(x.descripcion).slice(0, 60))}</option>`).join('')}</optgroup>` : ''}
              <optgroup label="Secciones del formulario">${SECCIONES.flatMap(sx => sx.preguntas.filter(p => p.id > 4).map(p => `<option value="${p.id}" ${String(st.evid.preg) === String(p.id) && !incidencias.some(x => String(x.id_pregunta) === String(p.id)) ? 'selected' : ''}>#${p.id} · ${esc(p.texto.slice(0, 70))}</option>`)).join('')}</optgroup>
            </select></div>
          <div class="evid-desc"><label for="evid-desc">Descripción (opcional)</label>
            <input id="evid-desc" type="text" maxlength="200" placeholder="Ej.: filtración en el techo del aula 3, ala norte" value="${esc(st.evid.desc)}"></div>
        </div>
        <label class="evid-zona" id="evid-zona" for="evid-archivos">
          ${icono('Upload', 'grande')}
          <strong>Arrastrá las fotos acá o tocá para elegirlas</strong>
          <span class="nota">JPG, PNG o WebP · se reducen a ${LADO_MAXIMO} px antes de subir y se les quitan los metadatos de ubicación</span>
          <input id="evid-archivos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
        </label>
        <p class="evid-aviso">${icono('TriangleAlert')} <span>No subas fotos en las que se reconozca a personas, en especial a alumnos y alumnas. Las fotos quedan en una carpeta <strong>privada</strong> de Google Drive y sólo se ven desde este Monitor con la clave del equipo.</span></p>
      </form>` : '<p class="nota">Con la clave de solo lectura podés ver las fotos, pero no cargarlas ni quitarlas.</p>'}
      ${cola.length ? `<ul class="evid-cola" aria-live="polite">${cola.map(c => `<li class="ec-${c.estado}"><span>${esc(c.nombre)}</span><span>${{ procesando: 'Preparando…', subiendo: 'Subiendo…', ok: 'Cargada', error: esc(c.msg || 'Error') }[c.estado]}</span></li>`).join('')}</ul>` : ''}
      ${e.evidencias.length ? `<div class="evid-grilla">${e.evidencias.map(ev => `<figure class="evid-item">
          ${miniatura(ev)}
          <figcaption>
            <strong>${esc(ev.descripcion || 'Sin descripción')}</strong>
            <small>${ev.id_pregunta ? `#${ev.id_pregunta} · ` : ''}${fechaHora(ev.fecha_carga)}${ev.id_relevamiento ? '' : ' · sin relevamiento'}</small>
            <span class="evid-acc">${ev.url_drive && !st.datos.ejemplo ? `<a href="${esc(ev.url_drive)}" target="_blank" rel="noopener">${icono('OpenInNew')} Drive</a>` : ''}
              ${puede ? `<button class="link link-peligro" data-quitar-evid="${esc(ev.id_evidencia)}">${icono('Trash2')} Quitar</button>` : ''}</span>
          </figcaption></figure>`).join('')}</div>` : '<p class="vacio">Todavía no hay fotos cargadas para esta institución.</p>'}
    </article>`;
}

/** Pide al servidor las miniaturas que todavía no están en memoria (de a tres por vez). */
async function cargarMiniaturas() {
  if (st.datos?.ejemplo) return;
  const pend = [...document.querySelectorAll('[data-evid-id]')].map(el => el.dataset.evidId).filter(id => !st.imagenes.has(id));
  const unicos = [...new Set(pend)];
  unicos.forEach(id => st.imagenes.set(id, 'cargando'));
  const trabajar = async () => {
    while (unicos.length) {
      const id = unicos.shift();
      try {
        const r = await fetch(`${st.config.url}?accion=evidencia&id=${encodeURIComponent(id)}&token=${encodeURIComponent(st.config.token)}`);
        const j = await r.json(); if (!j.ok) throw new Error(j.error);
        st.imagenes.set(id, `data:${j.mime};base64,${j.base64}`);
      } catch { st.imagenes.set(id, 'error'); }
      refrescarMiniatura(id);
    }
  };
  await Promise.all([trabajar(), trabajar(), trabajar()]);
}

function refrescarMiniatura(id) {
  const ev = (st.datos.evidencias || []).find(x => x.id_evidencia === id); if (!ev) return;
  document.querySelectorAll(`[data-ver-evid="${CSS.escape(id)}"]`).forEach(b => { b.outerHTML = miniatura(ev); });
}

/** Reduce la foto (lado máximo LADO_MAXIMO) y la convierte a JPEG; al redibujarla se descartan los metadatos EXIF. */
async function prepararFoto(archivo) {
  if (!MIME_ADMITIDOS.includes(archivo.type)) throw new Error(/heic|heif/i.test(archivo.name) ? 'Formato HEIC: exportala como JPG' : 'Formato no admitido');
  let img;
  try { img = await createImageBitmap(archivo); } catch { throw new Error('No se pudo leer la imagen'); }
  const k = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(img.width * k); lienzo.height = Math.round(img.height * k);
  lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
  img.close?.();
  const blob = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', CALIDAD_JPEG));
  const url = await new Promise((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = mal; fr.readAsDataURL(blob); });
  return { mime: 'image/jpeg', dataUrl: url, base64: String(url).split(',')[1] };
}

async function subirFotos(archivos) {
  const e = st.m.porCue.get(st.evid.cue); if (!e || !archivos.length) return;
  const relSel = st.evid.rel === '' && e.rels[0] ? e.rels[0].id_relevamiento : st.evid.rel;
  const base = { cue: e.cue, idRelevamiento: relSel === '__ninguno' ? '' : relSel, idPregunta: st.evid.preg ? Number(st.evid.preg) : '', descripcion: st.evid.desc.trim() };
  const items = [...archivos].map(f => ({ archivo: f, nombre: f.name, cue: e.cue, estado: 'procesando' }));
  st.evid.cola = st.evid.cola.filter(c => c.estado !== 'ok').concat(items);
  pintar();
  let ok = 0;
  for (const it of items) {
    try {
      const foto = await prepararFoto(it.archivo);
      it.estado = 'subiendo'; pintar();
      let ev;
      if (st.datos.ejemplo) {
        ev = { id_evidencia: `EJ-EV-${Date.now()}-${Math.random().toString(16).slice(2)}`, cue_base: e.cue, establecimiento: e.nombre, id_relevamiento: base.idRelevamiento,
          id_pregunta: base.idPregunta, descripcion: base.descripcion, nombre_archivo: it.nombre, tipo_mime: foto.mime, fecha_carga: new Date().toISOString() };
      } else {
        const r = await fetch(st.config.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ token: st.config.token, accion: 'subirEvidencia', ...base, nombre: it.nombre, mime: foto.mime, base64: foto.base64 }) });
        const j = await r.json(); if (!j.ok) throw new Error(j.error);
        ev = j.evidencia;
      }
      st.imagenes.set(ev.id_evidencia, foto.dataUrl); // vista previa inmediata, sin volver a descargarla
      (st.datos.evidencias || (st.datos.evidencias = [])).push(ev);
      it.estado = 'ok'; ok++;
    } catch (err) { it.estado = 'error'; it.msg = err.message.includes('Failed to fetch') ? 'Sin conexión con la planilla' : err.message; }
    st.m = construirModelo(st.datos); pintar();
  }
  if (ok) aviso(`${ok} foto${ok > 1 ? 's' : ''} cargada${ok > 1 ? 's' : ''} en ${e.nombre}.${st.datos.ejemplo ? ' (Sólo en esta vista de ejemplo.)' : ''}`, 'ok');
}

async function quitarEvidencia(boton) {
  if (!boton.dataset.confirmar) { boton.dataset.confirmar = '1'; boton.innerHTML = `${icono('Trash2')} Tocá de nuevo para quitar`; return; }
  const id = boton.dataset.quitarEvid; boton.disabled = true;
  try {
    if (!st.datos.ejemplo) {
      const r = await fetch(st.config.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: st.config.token, accion: 'quitarEvidencia', id }) });
      const j = await r.json(); if (!j.ok) throw new Error(j.error);
    }
    st.datos.evidencias = st.datos.evidencias.filter(x => x.id_evidencia !== id);
    st.m = construirModelo(st.datos); pintar();
    aviso(st.datos.ejemplo ? 'Foto quitada (sólo en esta vista de ejemplo).' : 'Foto quitada. Queda 30 días en la papelera de Google Drive.', 'ok');
  } catch (err) { boton.disabled = false; aviso(`No se pudo quitar: ${err.message}`, 'error'); }
}

async function verEvidencia(id) {
  const ev = (st.datos.evidencias || []).find(x => x.id_evidencia === id); if (!ev) return;
  let dlg = $('#evid-dialogo');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'evid-dialogo'; dlg.className = 'evid-dialogo'; document.body.appendChild(dlg); }
  const pintarDlg = src => {
    dlg.innerHTML = `<div class="ed-cab"><div><strong>${esc(ev.descripcion || 'Sin descripción')}</strong><small>${esc(ev.establecimiento)} · ${ev.id_pregunta ? `#${ev.id_pregunta} · ` : ''}${fechaHora(ev.fecha_carga)}</small></div>
      <button class="btn-ico" data-cerrar-dlg aria-label="Cerrar">${icono('X')}</button></div>
      ${src ? `<img src="${src}" alt="${esc(`Evidencia de ${ev.establecimiento}${ev.descripcion ? `: ${ev.descripcion}` : ''}`)}">` : `<p class="cargando">${icono('RefreshCw', 'girando')} Cargando la foto…</p>`}`;
  };
  const previa = st.imagenes.get(id);
  pintarDlg(previa && previa !== 'cargando' && previa !== 'error' ? previa : '');
  if (!dlg.open) dlg.showModal();
  if (!st.datos.ejemplo) {
    try {
      const r = await fetch(`${st.config.url}?accion=evidencia&id=${encodeURIComponent(id)}&tamano=completa&token=${encodeURIComponent(st.config.token)}`);
      const j = await r.json(); if (j.ok && dlg.open) pintarDlg(`data:${j.mime};base64,${j.base64}`);
    } catch { /* queda la miniatura */ }
  }
}

/* ================= Pintado ================= */

function vistaConexion() {
  const c = st.config;
  return `<section class="conexion panel">
    <h3>Conexión con la planilla central</h3>
    <p class="nota">Ingrese la clave del equipo (lectura y gestión) o la clave de solo lectura para autoridades.</p>
    ${st.error ? `<p class="error">${icono('TriangleAlert')} ${esc(st.error)}</p>` : ''}
    <label for="c-url">URL de la aplicación web (Apps Script)</label><input id="c-url" type="url" value="${esc(c.url)}">
    <label for="c-token">Clave de acceso</label><input id="c-token" type="password" value="${esc(c.token)}" autocomplete="off">
    <div class="acciones"><button class="boton boton--primario" id="c-conectar">${icono('RefreshCw')} Conectar</button>
      <button class="boton boton--secundario" id="c-ejemplo">Ver con datos de ejemplo</button></div>
  </section>`;
}

function vistaActual() { const v = location.hash.replace('#', ''); return VISTAS.some(([k]) => k === v) ? v : 'panorama'; }

function pintar() {
  if (st.mapa) { st.mapa.remove(); st.mapa = null; }
  const v = vistaActual();
  const app = $('#app');
  actualizarIntro();
  if (st.cargando && !st.m) { app.innerHTML = `<div class="cargando">${icono('RefreshCw', 'girando')} Leyendo la planilla central…</div>`; return; }
  const sinDatos = !st.m;
  const barriosDisp = st.m ? [...new Set(st.m.escuelas.flatMap(e => listaBarrios(e.barrio)))].sort((a, b) => a.localeCompare(b, 'es')) : [];
  const nivelesDisp = st.m ? [...new Set(st.m.escuelas.flatMap(e => e.niveles))].filter(n => n !== 'Todos').sort() : [];
  app.innerHTML = `
    <div class="herramientas">
      ${st.m ? `<nav class="tabs" aria-label="Vistas del monitor">${VISTAS.map(([k, t]) => `<a href="#${k}" class="${v === k ? 'activo' : ''}" ${v === k ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>` : ''}
      <div class="herramientas-der">${st.m ? `<button class="boton boton--secundario boton--chico" id="recargar">${icono('RefreshCw', st.cargando ? 'girando' : '')} Actualizar</button>` : ''}
        <button class="boton boton--secundario boton--chico" id="ajustes" aria-pressed="${!!st.mostrarConexion}">${icono('Settings')} Conexión</button></div>
    </div>
    ${st.datos?.ejemplo ? `<div class="banda-ejemplo">${icono('TriangleAlert')} <b>Datos de ejemplo.</b> Relevamientos simulados sobre el padrón real con el motor del IES. No corresponden a relevamientos efectuados. <button class="link" id="salir-ejemplo">Conectar con la planilla</button></div>` : ''}
    ${st.m ? `<div class="filtros-globales">
      <input id="f-texto" type="search" placeholder="Buscar institución, CUE o dirección" value="${esc(st.filtros.texto)}" aria-label="Buscar">
      <select id="f-barrio" aria-label="Barrio"><option value="">Todos los barrios</option>${barriosDisp.map(b => `<option ${st.filtros.barrio === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <select id="f-nivel" aria-label="Nivel"><option value="">Todos los niveles</option>${nivelesDisp.map(n => `<option ${st.filtros.nivel === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${st.filtros.barrio || st.filtros.nivel || st.filtros.texto ? '<button class="link" id="limpiar">Quitar filtros</button>' : ''}
    </div>` : ''}
    <div class="contenido">${sinDatos || st.mostrarConexion ? vistaConexion() : v === 'instituciones' ? vistaInstituciones() : v === 'incidencias' ? vistaIncidencias() : v === 'evidencias' ? vistaEvidencias() : vistaPanorama()}</div>`;
  if (st.m && !st.mostrarConexion && v === 'panorama') dibujarMapa();
  pintarFicha();
  if (st.m) cargarMiniaturas();
}

/** Línea «actualizado» de la intro de la plantilla: fuente y hora de los datos. */
function actualizarIntro() {
  const el = $('#intro-actualizado'); if (!el) return;
  if (!st.datos) { el.textContent = st.cargando ? 'Leyendo la planilla central…' : 'Sin conexión con la planilla central.'; return; }
  const hora = new Date(st.datos.generado).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  el.textContent = st.datos.ejemplo
    ? `Datos de ejemplo generados el ${hora} · último relevamiento de cada institución.`
    : `Datos de «${st.datos.planilla || 'planilla central'}» al ${hora} · último relevamiento de cada institución.`;
}

function dibujarMapa() {
  const L = window.L; const el = $('#mapa'); if (!L || !el) return;
  st.mapa = L.map(el, { scrollWheelZoom: false, attributionControl: true }).setView([-33.123, -64.349], 13);
  // Mapa base: Argenmap gris del Instituto Geográfico Nacional (servicio TMS oficial, ver
  // ign.gob.ar › Servicios OGC › Leaflet). {-y}: el TMS numera las filas de abajo hacia arriba.
  L.tileLayer('https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/mapabase_gris@EPSG%3A3857@png/{z}/{x}/{-y}.png', {
    minZoom: 3, maxZoom: 18,
    attribution: '<a href="https://www.ign.gob.ar/AreaServicios/Argenmap/IntroduccionV2" target="_blank" rel="noopener">Instituto Geográfico Nacional</a> + <a href="https://www.osm.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(st.mapa);
  // Los colores salen de css/tokens.css: el mapa sigue al modo claro/oscuro.
  const css = getComputedStyle(document.documentElement);
  const tk = n => css.getPropertyValue(n).trim();
  const colores = { optimo: tk('--ies-optimo'), bueno: tk('--ies-bueno'), regular: tk('--ies-regular'), critico: tk('--ies-critico'), roja: tk('--ies-roja'), curso: tk('--ies-curso'), pendiente: tk('--superficie') };
  const borde = tk('--superficie'), bordePendiente = tk('--texto-suave');
  if (st.verBarrios) dibujarBarrios(L, tk);
  const puntos = [];
  for (const e of escuelasFiltradas()) {
    const c = e.coordenadas?.[0]; if (!c) continue;
    puntos.push(c);
    const m = L.circleMarker(c, {
      radius: e.clase === 'roja' ? 10 : 7, weight: e.clase === 'roja' ? 3 : 2,
      color: e.clase === 'pendiente' ? bordePendiente : e.clase === 'roja' ? tk('--texto') : borde,
      fillColor: colores[e.clase], fillOpacity: e.clase === 'pendiente' ? 0.9 : 1
    }).addTo(st.mapa);
    m.bindTooltip(`<b>${esc(e.nombre)}</b><br>${CLASES[e.clase]}${e.ies != null ? ` · IES ${e.ies}` : ''}`, { direction: 'top' });
    m.on('click', () => abrirFicha(e.cue));
  }
  if (puntos.length > 1) {
    // Encuadre sobre el núcleo urbano (percentiles 5–95): las escuelas rurales siguen en el mapa al alejarse.
    const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
    const la = puntos.map(c => c[0]), lo = puntos.map(c => c[1]);
    st.mapa.fitBounds([[q(la, 0.05), q(lo, 0.05)], [q(la, 0.95), q(lo, 0.95)]], { padding: [28, 28], maxZoom: 15 });
  }
}

/* ================= Capa «Barrios» ================= */

/* Distribución barrial: capa «Barrios» del repositorio Mapas de la Dirección de Estadística
   (Barrios/2026_barrios_estandarizados), convertida de POSGAR 98 faja 4 (EPSG:22174) a
   WGS 84 en datos/barrios-rio-cuarto.geojson. La descarga y el cruce con las escuelas
   están en js/barrios.js (compartido con la PWA). */
/** Nombre comparable entre la capa («Bo. Jardín Norte») y el padrón («Jardin Norte»). */
const claveBarrio = s => sinTildes(s).replace(/^(bo\.?|barrio)\s+/, '').trim();
const mismoBarrio = (capa, padron) => capa === padron; // el barrio de cada escuela ya es el nombre del polígono

function dibujarBarrios(L, tk) {
  const mapa = st.mapa;
  // Panel propio debajo de los puntos: los polígonos nunca tapan ni bloquean una escuela.
  mapa.createPane('barrios').style.zIndex = 350;
  const elegidos = String(st.filtros.barrio || '').split('|').map(claveBarrio).filter(Boolean);
  const esElegido = nombre => { const c = claveBarrio(nombre); return elegidos.some(b => mismoBarrio(c, b)); };
  cargarBarrios().then(geo => {
    if (!geo || st.mapa !== mapa) return; // el mapa se redibujó mientras se descargaba
    L.geoJSON(geo, {
      pane: 'barrios',
      style: f => {
        const sel = esElegido(f.properties.nombre);
        return { color: sel ? tk('--marca') : tk('--texto-suave'), weight: sel ? 2.5 : 1, opacity: sel ? 1 : 0.75,
          fillColor: tk('--marca'), fillOpacity: sel ? 0.14 : 0.03 };
      },
      onEachFeature: (f, capa) => {
        capa.bindTooltip(esc(f.properties.nombre), { sticky: true, direction: 'top', className: 'tip-barrio' });
        capa.on('mouseover', () => capa.setStyle({ weight: 2.5, fillOpacity: 0.12 }));
        capa.on('mouseout', () => { const sel = esElegido(f.properties.nombre); capa.setStyle({ weight: sel ? 2.5 : 1, fillOpacity: sel ? 0.14 : 0.03 }); });
      }
    }).addTo(mapa);
  });
}

/* ================= Interacción ================= */

function abrirFicha(cue) { st.seleccion = cue; pintarFicha(); }
function cerrarFicha() { st.seleccion = null; pintarFicha(); }
function pintarFicha() {
  const f = $('#ficha'), v = $('#velo'); if (!f) return;
  const e = st.seleccion && st.m.porCue.get(st.seleccion);
  f.innerHTML = e ? ficha(e) : '';
  if (e) cargarMiniaturas();
  f.classList.toggle('abierta', !!e); f.setAttribute('aria-hidden', String(!e)); v.classList.toggle('visible', !!e);
  if (e) f.scrollTop = 0;
}

let tTexto;
document.addEventListener('input', ev => {
  if (ev.target.id === 'evid-desc') { st.evid.desc = ev.target.value; return; }
  if (ev.target.id === 'evid-buscar') { clearTimeout(tTexto); tTexto = setTimeout(() => { st.evid.buscar = ev.target.value; const pos = ev.target.selectionStart; pintar(); const n = $('#evid-buscar'); n.focus(); n.setSelectionRange(pos, pos); }, 250); return; }
  if (ev.target.id === 'f-texto') { clearTimeout(tTexto); tTexto = setTimeout(() => { st.filtros.texto = ev.target.value; const pos = ev.target.selectionStart; pintar(); const n = $('#f-texto'); n.focus(); n.setSelectionRange(pos, pos); }, 250); }
});

document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.id === 'f-barrio') { st.filtros.barrio = t.value; pintar(); }
  if (t.id === 'f-nivel') { st.filtros.nivel = t.value; pintar(); }
  if (t.id === 'fi-rubro') { st.inc.rubro = t.value; pintar(); }
  if (t.id === 'fi-crit') { st.inc.criticidad = t.value; pintar(); }
  if (t.id === 'fi-jur') { st.inc.jurisdiccion = t.value; pintar(); }
  if (t.id === 'fi-ks') { st.inc.soloKS = t.checked; pintar(); }
  if (t.id === 'ver-barrios') { st.verBarrios = t.checked; pintar(); }
  if (t.classList.contains('g-sel')) await cambiarGestion(t);
  if (t.id === 'evid-rel') { st.evid.rel = t.value; st.evid.preg = ''; pintar(); }
  if (t.id === 'evid-preg') { st.evid.preg = t.value; }
  if (t.id === 'evid-archivos') { const fs = [...t.files]; t.value = ''; await subirFotos(fs); }
});

async function cambiarGestion(sel) {
  const idRel = sel.dataset.rel, idPreg = Number(sel.dataset.preg), estado = sel.value;
  const item = st.m.incidencias.find(x => x.id_relevamiento === idRel && Number(x.id_pregunta) === idPreg);
  const anterior = item.estado_gestion;
  sel.disabled = true;
  try {
    if (!st.datos.ejemplo) {
      const r = await fetch(st.config.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: st.config.token, accion: 'actualizarGestion', idRelevamiento: idRel, idPregunta: idPreg, estado }) });
      const j = await r.json(); if (!j.ok) throw new Error(j.error);
    }
    item.estado_gestion = estado;
    const fila = (st.datos.incidencias || []).find(x => x.id_relevamiento === idRel && Number(x.id_pregunta) === idPreg);
    if (fila) fila.estado_gestion = estado;
    st.m = construirModelo(st.datos);
    aviso(`Gestión actualizada: «${estado}».${st.datos.ejemplo ? ' (Sólo en esta vista de ejemplo.)' : ''}`, 'ok');
  } catch (e) {
    sel.value = anterior; aviso(`No se pudo actualizar: ${e.message}`, 'error');
  }
  sel.disabled = false;
  const scroll = $('#ficha')?.scrollTop;
  if (vistaActual() === 'incidencias') { const y = window.scrollY; pintar(); window.scrollTo(0, y); }
  if (st.seleccion) { pintarFicha(); $('#ficha').scrollTop = scroll; }
}

document.addEventListener('click', ev => {
  const t = ev.target.closest('button, tr[data-cue]'); if (!t) { if (ev.target.id === 'velo') cerrarFicha(); return; }
  if (t.id === 'cerrar-ficha') return cerrarFicha();
  if (t.dataset.verEvid) return verEvidencia(t.dataset.verEvid);
  if (t.dataset.cerrarDlg != null) return $('#evid-dialogo')?.close();
  if (t.dataset.quitarEvid) return quitarEvidencia(t);
  if (t.dataset.evidCue) { if (st.evid.cue !== t.dataset.evidCue) st.evid = { ...st.evid, cue: t.dataset.evidCue, rel: '', preg: '', desc: '' }; return pintar(); }
  if (t.dataset.irEvid) { st.evid = { ...st.evid, cue: t.dataset.irEvid, rel: '', preg: '', desc: '' }; cerrarFicha(); if (location.hash === '#evidencias') pintar(); else location.hash = 'evidencias'; return; }
  if (t.dataset.cue) return abrirFicha(t.dataset.cue);
  if (t.dataset.orden) { st.orden = { col: t.dataset.orden, dir: st.orden.col === t.dataset.orden ? -st.orden.dir : 1 }; return pintar(); }
  if (t.dataset.rubro) { st.inc = { ...st.inc, rubro: t.dataset.rubro, gestion: 'abiertas' }; location.hash = 'incidencias'; return; }
  if (t.dataset.barrio != null && t.classList.contains('hbar')) { st.filtros.barrio = t.dataset.barrio; return pintar(); }
  if (t.dataset.gestion) { st.inc.gestion = t.dataset.gestion; return pintar(); }
  if (t.id === 'limpiar') { st.filtros = { barrio: '', nivel: '', texto: '' }; return pintar(); }
  if (t.id === 'recargar') return cargar();
  if (t.id === 'ajustes') { st.mostrarConexion = !st.mostrarConexion; return pintar(); }
  if (t.id === 'exportar') return exportarCSV();
  if (t.id === 'salir-ejemplo') { st.config.ejemplo = false; guardarConfig(st.config); st.datos = null; st.m = null; st.mostrarConexion = true; return pintar(); }
  if (t.id === 'c-ejemplo') { st.config.ejemplo = true; guardarConfig(st.config); st.mostrarConexion = false; return cargar(); }
  if (t.id === 'c-conectar') {
    st.config = { url: $('#c-url').value.trim(), token: $('#c-token').value.trim(), ejemplo: false };
    guardarConfig(st.config); st.mostrarConexion = false; st.datos = null; st.m = null; return cargar();
  }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && st.seleccion) cerrarFicha();
  if (ev.key === 'Enter' && ev.target.matches('tr[data-cue]')) abrirFicha(ev.target.dataset.cue);
});
window.addEventListener('hashchange', () => { pintar(); });
// Al cambiar el tema (botón del header), se redibuja para que el mapa tome los colores nuevos.
document.addEventListener('tema:cambio', () => { if (st.m) pintar(); });
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (st.m) pintar(); });

/* Arrastrar y soltar fotos sobre la zona de carga */
document.addEventListener('dragover', ev => { const z = ev.target.closest?.('#evid-zona'); if (z) { ev.preventDefault(); z.classList.add('arrastrando'); } });
document.addEventListener('dragleave', ev => { const z = ev.target.closest?.('#evid-zona'); if (z && !z.contains(ev.relatedTarget)) z.classList.remove('arrastrando'); });
document.addEventListener('drop', ev => { const z = ev.target.closest?.('#evid-zona'); if (!z) return; ev.preventDefault(); z.classList.remove('arrastrando'); subirFotos([...ev.dataTransfer.files]); });
document.addEventListener('click', ev => { const d = $('#evid-dialogo'); if (d && ev.target === d) d.close(); }); // clic fuera de la foto

/* Tooltip compartido para barras y controles con data-tip */
const tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
document.addEventListener('mouseover', ev => { const el = ev.target.closest('[data-tip]'); if (!el) { tip.classList.remove('visible'); return; } tip.textContent = el.dataset.tip; tip.classList.add('visible'); });
document.addEventListener('mousemove', ev => { if (!tip.classList.contains('visible')) return; const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8); tip.style.transform = `translate(${x}px, ${ev.clientY + 16}px)`; });

function aviso(msg, tipo = 'info') {
  const t = document.createElement('div'); t.className = `toast t-${tipo}`; t.setAttribute('role', 'status'); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.classList.add('salir'), 3200); setTimeout(() => t.remove(), 3600);
}

function exportarCSV() {
  const cab = ['cue_base', 'establecimiento', 'barrio', 'ies_institucion', 'fecha_relevamiento', 'id_pregunta', 'rubro', 'criticidad', 'jurisdiccion', 'puntos', 'kill_switch', 'hallazgo', 'estado_gestion', 'observacion_gestion', 'observacion_auditor'];
  const filas = incidenciasFiltradas().map(x => [x.cue_base, x.establecimiento, x.barrio, x.escuela?.ies ?? '', x.fecha_relevamiento, x.id_pregunta, x.tipo_incidencia, x.criticidad, JUR[x.jurisdiccion] || x.jurisdiccion, x.puntos, x.ks ? 'SI' : 'NO', x.descripcion, x.estado_gestion, x.observacion_gestion || '', x.observacion_auditor || '']);
  const csv = '﻿' + [cab, ...filas].map(f => f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `plan-intervencion-fodemeep-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ================= Arranque ================= */
if (st.config.ejemplo || st.config.token) cargar(); else pintar();
