/**
 * PWA de Relevamiento Técnico Edilicio — FoDeMEEP Río Cuarto.
 * Dirección de Estadística, Control de Calidad y Procesos.
 * Interfaz de una sola página con enrutamiento por fragmento (#/...).
 */
import { SECCIONES, PREGUNTAS, VERSION_CATALOGO, DIMENSIONES, PARAMETROS_IES, preguntaVisible, normalizarRespuestas, VALOR_NA, TEXTO_NA, esNoAplica } from './catalogo.js';
import { calcularIES, validarConsistencia, faltantesRequeridas } from './motor-ies.js';
import { db, nuevoId } from './db.js';
import { sincronizarPendientes, sincronizarUno, obtenerConfig, nombreDe } from './sync.js';
import { icono, textoSinIcono } from './iconos.js';
import { listaBarrios } from './barrios.js';
import { obtenerPadron, actualizarPadronDesdeServidor, filtrar, calcularEstados, textoBarrio, resumenInstitucion } from './padron.js';

const $app = document.getElementById('app');
const $barra = document.getElementById('barra-contexto');
const $intro = document.getElementById('intro');

/** Pinta una vista: barra contextual (fija arriba), contenido y, sólo en el inicio, la intro de la plantilla. */
function pintarVista(barra, cuerpo, { intro = false } = {}) {
  $barra.innerHTML = barra;
  $intro.hidden = !intro;
  $app.innerHTML = cuerpo;
  window.scrollTo(0, 0);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoy = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fechaCorta = iso => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

let actual = null;        // relevamiento en edición
let temporizador = null;  // guardado diferido

const ESTADOS = {
  borrador: { txt: 'Borrador', cls: 'estado estado--neutro' },
  finalizado: { txt: 'Pendiente de envío', cls: 'estado estado--alerta' },
  sincronizado: { txt: 'Sincronizado', cls: 'estado estado--ok' }
};
const JUR_TXT = { FoDeMEEP: 'FoDeMEEP (municipal)', PROVINCIA_MAYOR: 'Provincia (obra mayor)' };

/* ================= Utilidades de interfaz ================= */

function aviso(msg, tipo = 'info', ms = 3200) {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.setAttribute('role', 'status');
  t.innerHTML = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.classList.add('salir'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Mientras ninguna dimensión esté completa (y no haya Kill-Switch) el índice se muestra en gris: está en relevamiento. */
const claseIES = res => !res || res.ies == null || (!res.dimensionesCompletas && !res.killSwitches?.length) ? 'vacio' : res.clasificacion.clase;

function chipIES(res) {
  if (!res || res.ies == null) return `<span class="chip-ies c-vacio">IES —</span>`;
  return `<span class="chip-ies c-${claseIES(res)}">IES ${res.ies}</span>`;
}

function etiquetaInc(i) {
  return `<span class="inc crit-${i.criticidad}">${esc(i.tipo)} · ${i.criticidad} · ${i.jurisdiccion === 'PROVINCIA_MAYOR' ? 'Provincia' : 'FoDeMEEP'} · ${i.puntos} pts</span>`;
}

/* ================= Memoria de trabajo (auditorías de varios días) ================= */

/** Fecha local AAAA-MM-DD (la jornada de trabajo es la del auditor, no la UTC). */
const fechaLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fechaDia = f => { const [a, m, d] = f.split('-'); return `${d}/${m}/${a.slice(2)}`; };

/** Registra que hoy se trabajó en la sección indicada (una entrada por día). */
function registrarJornada(r, seccion) {
  r.jornadas = r.jornadas || [];
  const hoy = fechaLocal();
  let j = r.jornadas.find(x => x.fecha === hoy);
  if (!j) { j = { fecha: hoy, secciones: [] }; r.jornadas.push(j); }
  if (seccion && !j.secciones.includes(seccion)) j.secciones.push(seccion);
}

/** Avance por sección de un relevamiento: completas, pendientes y la sección donde retomar. */
function resumenAvance(r) {
  const resp = normalizarRespuestas(r.respuestas || {});
  const estado = SECCIONES.map(sx => ({ n: sx.n, titulo: sx.titulo, ...progresoSeccion(sx, resp) }));
  const completas = estado.filter(x => x.total && x.ok === x.total);
  const pendientes = estado.filter(x => x.total && x.ok < x.total);
  const ultima = SECCIONES.find(x => x.n === r.ultimaSeccion);
  // Se retoma en la última sección visitada; si ya está completa, en la primera pendiente.
  const ultEstado = estado.find(x => x.n === r.ultimaSeccion);
  const retomar = ultima && ultEstado && ultEstado.ok < ultEstado.total ? ultima : (SECCIONES.find(x => x.n === pendientes[0]?.n) || ultima || SECCIONES[0]);
  return { completas, pendientes, retomar };
}

function guardarDiferido() {
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    if (!actual) return;
    actual.actualizado = new Date().toISOString();
    actual.resultado = calcularIES(actual.respuestas);
    if (actual.estado === 'sincronizado') actual.estado = 'finalizado'; // modificado tras el envío
    await db.guardar(actual);
    const ind = document.getElementById('ind-guardado');
    if (ind) { ind.textContent = 'Guardado en el dispositivo'; ind.classList.add('ok'); }
  }, 350);
}

/* ================= Enrutador ================= */

async function enrutar() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  if (h[0] === 'r' && h[1]) {
    if (!actual || actual.id !== h[1]) actual = await db.obtener(h[1]);
    if (!actual) { location.hash = '#/'; return; }
    actual.respuestas = normalizarRespuestas(actual.respuestas); // valores históricos equivalentes
    actual.observaciones = actual.observaciones || {};      // relevamientos anteriores a 2026.10-v4
    if (h[2] === 'resultado') return vistaResultado();
    if (h[2] === 'institucion') return vistaElegirInstitucion(actual);
    return vistaSeccion(Number(h[3]) || 1);
  }
  actual = null;
  if (h[0] === 'config') return vistaConfig();
  if (h[0] === 'nuevo') return vistaElegirInstitucion(null);
  return vistaInicio();
}

/* ================= Padrón de instituciones ================= */

function datosInstitucion(i) {
  return { cue: i.cue, nombre: i.nombre, barrio: i.barrio || '', niveles: i.niveles, direccion: i.direcciones[0] || '',
    direcciones: i.direcciones, coordenadas: i.coordenadas[0] || null };
}

async function crearRelevamiento(institucion) {
  const cfg = await obtenerConfig();
  const ahora = new Date().toISOString();
  const respuestas = { 4: hoy(), ...(cfg.tecnico ? { 3: cfg.tecnico } : {}) };
  if (institucion) respuestas[1] = resumenInstitucion(institucion);
  const r = { id: nuevoId(), creado: ahora, actualizado: ahora, estado: 'borrador', respuestas, observaciones: {},
    institucion: institucion ? datosInstitucion(institucion) : null, avisoInicio: institucion ? 'pendiente' : '' };
  r.resultado = calcularIES(r.respuestas);
  await db.guardar(r); actual = r;
  sincronizarPendientes().catch(() => {}); // informa «En curso» a la planilla si hay conexión
  location.hash = `#/r/${r.id}/s/1`;
}

let filtrosPadron = { texto: '', barrio: '', nivel: '', estado: '' };

async function vistaElegirInstitucion(relevamiento) {
  const padron = await obtenerPadron();
  const locales = await db.listar();
  const estados = calcularEstados(padron.instituciones, locales);
  // Un barrio por opción: una escuela con sedes en varios barrios aparece al filtrar por cualquiera de ellos.
  const barrios = [...new Set(padron.instituciones.flatMap(i => listaBarrios(i.barrio).length ? listaBarrios(i.barrio) : ['']))].sort((a, b) => (a || 'zzz').localeCompare(b || 'zzz'));
  const niveles = [...new Set(padron.instituciones.flatMap(i => i.niveles))].filter(n => n !== 'Todos').sort();
  const volver = relevamiento ? `#/r/${relevamiento.id}/s/1` : '#/';

  pintarVista(`
    <header class="barra"><div class="barra-interior"><a class="btn-ico" href="${volver}" aria-label="Volver">${icono('ChevronLeft')}</a>
      <div class="rel-tit"><strong>${relevamiento ? 'Cambiar institución' : 'Elegir institución'}</strong><small>Padrón de ${padron.instituciones.length} establecimientos · ${padron.origen === 'servidor' ? 'actualizado desde la planilla' : 'copia local'}</small></div></div></header>`, `
      <div class="buscador">
        <input id="buscar" type="search" placeholder="Buscar por nombre, CUE, barrio o dirección" value="${esc(filtrosPadron.texto)}" autocomplete="off">
        <div class="filtros">
          <select id="f-barrio" aria-label="Barrio"><option value="">Todos los barrios</option>${barrios.map(b => `<option value="${esc(b)}" ${filtrosPadron.barrio === b && b !== '' ? 'selected' : ''}>${esc(textoBarrio(b))}</option>`).join('')}</select>
          <select id="f-nivel" aria-label="Nivel"><option value="">Todos los niveles</option>${niveles.map(n => `<option ${filtrosPadron.nivel === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
          <select id="f-estado" aria-label="Estado"><option value="">Todos los estados</option>
            ${[['pendiente', 'Pendientes'], ['en_curso', 'En curso en este dispositivo'], ['en_curso_otro', 'En curso por otro auditor'], ['relevada', 'Relevadas']].map(([v, t]) => `<option value="${v}" ${filtrosPadron.estado === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>
      </div>
      <p class="sutil" id="cuenta-inst"></p>
      <ul class="lista" id="lista-inst"></ul>
      <button class="boton boton--secundario boton--grande boton--ancho" id="no-listada">${icono('Plus')} La institución no está en el padrón</button>`);

  const pintar = () => {
    const lista = filtrar(padron.instituciones, filtrosPadron, estados);
    document.getElementById('cuenta-inst').textContent = `${lista.length} de ${padron.instituciones.length} instituciones`;
    document.getElementById('lista-inst').innerHTML = lista.map(i => {
      const e = estados.get(i.cue);
      const accion = relevamiento ? 'Asignar a este relevamiento'
        : e.clave === 'en_curso' ? 'Continuar relevamiento' : e.clave === 'relevada' ? 'Nuevo relevamiento' : 'Iniciar relevamiento';
      return `<li class="tarjeta-inst">
        <div class="tr-top"><strong>${esc(i.nombre)}</strong><span class="est-inst ei-${e.clase}">${esc(e.etiqueta)}${e.ies != null ? ` · IES ${e.ies}` : ''}</span></div>
        <div class="inst-meta"><span>CUE ${esc(i.cue)}</span><span>${esc(textoBarrio(i.barrio))}</span>${i.direcciones.length > 1 ? `<span>${i.direcciones.length} sedes</span>` : ''}</div>
        <div class="inst-dir">${esc(i.direcciones[0] || 'Sin dirección registrada')}</div>
        <div class="niveles">${i.niveles.map(n => `<span class="nivel">${esc(n)}</span>`).join('')}${i.modalidades.filter(m => m !== 'Común').map(m => `<span class="nivel mod">${esc(m)}</span>`).join('')}</div>
        <div class="inst-acc">
          <button class="boton boton--primario" data-elegir="${esc(i.cue)}">${accion}</button>
          ${!relevamiento && e.idLocal && e.clave === 'relevada' ? `<a class="boton boton--secundario" href="#/r/${e.idLocal}/resultado">Ver último</a>` : ''}
        </div></li>`;
    }).join('') || '<li class="vacio-estado"><p>No hay instituciones con esos filtros.</p></li>';
  };
  pintar();

  const leer = () => {
    filtrosPadron = { texto: document.getElementById('buscar').value, barrio: document.getElementById('f-barrio').value,
      nivel: document.getElementById('f-nivel').value, estado: document.getElementById('f-estado').value };
    pintar();
  };
  document.getElementById('buscar').addEventListener('input', leer);
  ['f-barrio', 'f-nivel', 'f-estado'].forEach(id => document.getElementById(id).addEventListener('change', leer));

  document.getElementById('lista-inst').addEventListener('click', async ev => {
    const b = ev.target.closest('[data-elegir]'); if (!b) return;
    const inst = padron.instituciones.find(i => i.cue === b.dataset.elegir);
    if (relevamiento) {
      relevamiento.institucion = datosInstitucion(inst);
      relevamiento.respuestas[1] = resumenInstitucion(inst);
      relevamiento.avisoInicio = 'pendiente';
      relevamiento.actualizado = new Date().toISOString();
      await db.guardar(relevamiento);
      aviso(`${icono('Check')} Institución asignada: ${esc(inst.nombre)}.`, 'ok');
      location.hash = `#/r/${relevamiento.id}/s/1`;
      return;
    }
    const e = estados.get(inst.cue);
    if (e.clave === 'en_curso') { const r = await db.obtener(e.idLocal); location.hash = `#/r/${e.idLocal}/s/${r ? resumenAvance(r).retomar.n : 1}`; return; }
    if (e.clave === 'en_curso_otro' && !b.dataset.confirmar) {
      b.dataset.confirmar = '1'; b.textContent = 'Otro auditor la está relevando. Tocar para continuar igual'; return;
    }
    await crearRelevamiento(inst);
  });

  document.getElementById('no-listada').onclick = async () => {
    if (relevamiento) {
      relevamiento.institucion = null; delete relevamiento.respuestas[1];
      await db.guardar(relevamiento); location.hash = `#/r/${relevamiento.id}/s/1`; return;
    }
    await crearRelevamiento(null);
  };
  if (!relevamiento) document.getElementById('buscar').focus({ preventScroll: true });
}

/* ================= Vista: Inicio ================= */

async function vistaInicio() {
  const lista = (await db.listar()).sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
  const pend = lista.filter(r => r.estado === 'finalizado').length;
  const padron = await obtenerPadron();
  const est = [...calcularEstados(padron.instituciones, lista).values()];
  const totalInst = padron.instituciones.length;
  const nRel = est.filter(e => e.clave === 'relevada').length;
  const nCurso = est.filter(e => e.clave === 'en_curso' || e.clave === 'en_curso_otro').length;
  const nAlerta = est.filter(e => e.clase === 'alerta').length;
  const avisoAlmacenamiento = await textoAvisoAlmacenamiento(lista);
  document.getElementById('intro-actualizado').textContent =
    `Catálogo ${VERSION_CATALOGO} · ${SECCIONES.length} secciones · ${PREGUNTAS.size} preguntas · Padrón de ${totalInst} instituciones (${padron.origen === 'servidor' ? 'actualizado desde la planilla' : 'copia local'}).`;
  pintarVista('', `
      <section class="cobertura" aria-label="Cobertura del padrón">
        <div class="cob-top"><span>Cobertura del padrón</span><b>${nRel} <small>de ${totalInst} relevadas</small></b></div>
        <div class="cob-barra"><div class="cb-rel" style="width:${100 * nRel / totalInst}%"></div><div class="cb-curso" style="width:${100 * nCurso / totalInst}%"></div></div>
        <div class="cob-ref"><span><i class="cb-rel"></i>Relevadas ${nRel}</span><span><i class="cb-curso"></i>En curso ${nCurso}</span><span><i></i>Pendientes ${totalInst - nRel - nCurso}</span>${nAlerta ? `<span class="texto-ks">${icono('Siren')} ${nAlerta} con Alerta Roja</span>` : ''}</div>
      </section>
      <a class="boton boton--primario boton--grande boton--ancho" href="#/nuevo" id="nuevo">${icono('Plus')} Nuevo relevamiento</a>
      <div class="fila-acciones">
        <button class="boton boton--secundario" id="sync" ${pend ? '' : 'disabled'}>${icono('CloudUpload')} Sincronizar ${pend ? `(${pend})` : ''}</button>
        <a class="boton boton--secundario" href="#/config">${icono('Settings')} Configuración</a>
      </div>
      ${avisoAlmacenamiento}
      ${misAuditorias(lista)}`, { intro: true });

  document.getElementById('sync').onclick = ejecutarSync;
}

/** «Mis auditorías»: memoria de las escuelas que el auditor trabajó en este celular. */
function misAuditorias(lista) {
  if (!lista.length) return `<h2 class="titulo-lista">Mis auditorías</h2>
    <div class="vacio-estado">${icono('ClipboardList', 'grande')}<p>Todavía no hay relevamientos en este celular.</p><p class="sutil">Cada escuela que empieces queda guardada acá, aunque la auditoría lleve varios días y aunque no haya señal.</p></div>`;
  const enCurso = lista.filter(r => r.estado === 'borrador');
  const pendientes = lista.filter(r => r.estado === 'finalizado');
  const enviadas = lista.filter(r => r.estado === 'sincronizado');

  const tarjetaEnCurso = r => {
    const av = resumenAvance(r); const res = r.resultado;
    const jornadas = (r.jornadas || []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
    const dias = jornadas.length;
    const pct = res?.avance?.porcentaje ?? 0;
    return `<li class="aud aud-curso">
      <div class="tr-top"><strong>${esc(nombreDe(r))}</strong>${chipIES(res)}</div>
      ${r.institucion ? `<small class="aud-sub">CUE ${esc(r.institucion.cue)} · ${esc(textoBarrio(r.institucion.barrio))}</small>` : ''}
      <div class="aud-avance" role="img" aria-label="Avance ${pct}%"><div style="width:${pct}%"></div></div>
      <div class="aud-datos">
        <span><b>${av.completas.length}</b> de ${SECCIONES.length} secciones completas · ${pct}% de las preguntas</span>
        <span>${dias ? `${icono('ClipboardList')} ${dias === 1 ? '1 día de trabajo' : `${dias} días de trabajo`} · empezó el ${fechaDia(jornadas[0].fecha)}` : `Creado el ${fechaCorta(r.creado)}`}</span>
        <span>Último cambio: ${fechaCorta(r.actualizado)}</span>
        ${res?.killSwitches?.length ? `<span class="texto-ks">${icono('Siren')} ${res.killSwitches.length} Kill-Switch</span>` : ''}
      </div>
      ${av.pendientes.length ? `${[['A medias', av.pendientes.filter(x => x.ok > 0), 'parcial'], ['Sin empezar', av.pendientes.filter(x => x.ok === 0), '']].filter(([, l]) => l.length).map(([t, l, c]) => `<div class="aud-pend"><span>${t}:</span>${l.map(x => `<a href="#/r/${r.id}/s/${x.n}" class="aud-sec ${c}" title="Sección ${x.n}: ${esc(x.titulo)} (${x.ok} de ${x.total})" aria-label="Ir a la sección ${x.n}, ${esc(x.titulo)}: ${x.ok} de ${x.total} respondidas">${x.n}</a>`).join('')}</div>`).join('')}` : '<p class="aud-ok">Todas las secciones completas: falta revisar el resultado y finalizar.</p>'}
      ${dias > 1 ? `<details class="aud-bitacora"><summary>Ver jornadas</summary><ul>${jornadas.map(j => `<li><b>${fechaDia(j.fecha)}</b> · secciones ${j.secciones.slice().sort((a, b) => a - b).join(', ') || '—'}</li>`).join('')}</ul></details>` : ''}
      <div class="aud-acc">
        <a class="boton boton--primario" href="#/r/${r.id}/s/${av.retomar.n}">${icono('ChevronRight')} Continuar en la sección ${av.retomar.n}</a>
        <a class="boton boton--secundario" href="#/r/${r.id}/resultado">Resultado parcial</a>
      </div>
    </li>`;
  };
  const tarjetaCerrada = r => {
    const e = ESTADOS[r.estado]; const res = r.resultado; const dias = (r.jornadas || []).length;
    return `<li><a class="tarjeta-rel" href="#/r/${r.id}/resultado">
      <div class="tr-top"><strong>${esc(nombreDe(r))}</strong>${chipIES(res)}</div>
      <div class="tr-meta">
        <span class="${e.cls}">${e.txt}</span>
        <span>Finalizado ${fechaCorta(r.finalizado || r.actualizado)}</span>
        ${dias > 1 ? `<span>${dias} días de trabajo</span>` : ''}
        ${res?.killSwitches?.length ? `<span class="texto-ks">${icono('Siren')} ${res.killSwitches.length} Kill-Switch</span>` : ''}
      </div>
      ${r.errorSync ? `<div class="err-sync">${icono('TriangleAlert')} ${esc(r.errorSync)}</div>` : ''}
    </a></li>`;
  };
  return `<h2 class="titulo-lista">Mis auditorías <span class="cuenta">${lista.length}</span></h2>
    ${enCurso.length ? `<h3 class="sub-lista">En curso <span class="cuenta">${enCurso.length}</span></h3><ul class="lista">${enCurso.map(tarjetaEnCurso).join('')}</ul>` : ''}
    ${pendientes.length ? `<h3 class="sub-lista">Pendientes de envío <span class="cuenta">${pendientes.length}</span></h3><ul class="lista">${pendientes.map(tarjetaCerrada).join('')}</ul>` : ''}
    ${enviadas.length ? `<details class="sub-lista-det" ${enCurso.length + pendientes.length ? '' : 'open'}><summary><h3 class="sub-lista">Enviadas a la planilla <span class="cuenta">${enviadas.length}</span></h3></summary><ul class="lista">${enviadas.map(tarjetaCerrada).join('')}</ul></details>` : ''}
    <p class="sutil aud-pie">Todo queda guardado en este celular. Si vas a cambiar de teléfono o borrar datos del navegador, descargá antes un <a href="#/config">respaldo completo</a>.</p>`;
}

/**
 * Los navegadores pueden borrar los datos de un sitio por falta de espacio o, en iPhone,
 * tras varios días sin usarlo si no está instalado. Con la app instalada el almacenamiento
 * queda marcado como persistente.
 */
async function textoAvisoAlmacenamiento(lista) {
  if (!lista.some(r => r.estado !== 'sincronizado')) return '';
  let persistente = false;
  try { persistente = await navigator.storage?.persisted?.() || await navigator.storage?.persist?.() || false; } catch { /* sin soporte */ }
  if (persistente) return '';
  return `<div class="aviso-almac">${icono('TriangleAlert')}<div><b>Instalá la app en el celular para no perder los relevamientos en curso.</b>
    <span>Sin instalarla, el navegador puede borrar los datos guardados si se queda sin espacio o si pasan varios días sin usarla. En el menú del navegador elegí «Instalar aplicación» o «Agregar a la pantalla de inicio». Mientras tanto, conviene descargar un <a href="#/config">respaldo completo</a>.</span></div></div>`;
}

async function ejecutarSync() {
  const b = document.getElementById('sync'); if (b) { b.disabled = true; b.classList.add('girando'); }
  const { enviados, errores } = await sincronizarPendientes();
  if (enviados) aviso(`${icono('Check')} ${enviados} relevamiento(s) enviados a la planilla central.`, 'ok');
  if (errores.length) aviso(`${icono('TriangleAlert')} ${esc(errores[0])}`, 'error', 5000);
  if (!enviados && !errores.length) aviso('No hay relevamientos pendientes de envío.');
  if (!location.hash.startsWith('#/r/')) vistaInicio();
}

/* ================= Vista: Sección del formulario ================= */

function progresoSeccion(s, resp) {
  const vis = s.preguntas.filter(p => preguntaVisible(p, resp));
  const ok = vis.filter(p => { const v = resp[p.id]; return v != null && v !== '' && !(Array.isArray(v) && !v.length); }).length;
  return { ok, total: vis.length };
}

/** #1 vinculada al padrón: tarjeta de la institución elegida y, si corresponde, selección de sede. */
function renderInstitucion(p) {
  const i = actual.institucion;
  const cab = `<div class="p-cab"><span class="p-id">#1</span><span class="p-req">Requerida</span></div><span class="p-texto">${esc(p.texto)}</span>`;
  if (!i) {
    return `<article class="pregunta" id="p1" data-id="1">${cab}
      <input id="q1" data-q="1" type="text" placeholder="${esc(p.placeholder)}" value="${esc(actual.respuestas[1] || '')}" autocomplete="off">
      <small class="ayuda">Institución fuera del padrón: se carga a mano. <a href="#/r/${actual.id}/institucion">Elegir del padrón</a></small></article>`;
  }
  const sedes = i.direcciones || [];
  return `<article class="pregunta" id="p1" data-id="1">${cab}
    <div class="inst-elegida">
      <strong>${esc(i.nombre)}</strong>
      <div class="inst-meta"><span>CUE ${esc(i.cue)}</span><span>${esc(textoBarrio(i.barrio))}</span></div>
      <div class="niveles">${(i.niveles || []).map(n => `<span class="nivel">${esc(n)}</span>`).join('')}</div>
      <a href="#/r/${actual.id}/institucion" class="cambiar">Cambiar institución</a>
    </div>
    ${sedes.length > 1 ? `<span class="p-texto sede-tit">Sede relevada</span>
      <div class="opciones" role="radiogroup" aria-label="Sede relevada">${sedes.map((d, k) => `
        <button type="button" role="radio" aria-checked="${i.direccion === d}" class="opcion ${i.direccion === d ? 'sel' : ''}" data-sede="${k}">
          <span class="radio"></span><span class="opc-txt">${esc(d)}</span></button>`).join('')}</div>`
      : `<small class="ayuda">${esc(i.direccion || 'Sin dirección registrada en el padrón')}</small>`}
  </article>`;
}

/** Observación opcional del auditor, al pie de cada pregunta (no se pide en los datos de identificación). */
const SIN_OBSERVACION = new Set([1, 3, 4]);
function renderObservacion(p, v) {
  if (SIN_OBSERVACION.has(p.id)) return '';
  const texto = actual.observaciones?.[p.id] || '';
  const na = esNoAplica(p, v);
  return `<details class="obs" id="obs-${p.id}" ${texto || na ? 'open' : ''}>
      <summary>${icono('MessageSquareText')} Observación <span class="obs-op">(opcional)</span>${texto ? ' <span class="obs-tiene">· cargada</span>' : ''}</summary>
      <label class="obs-lbl" for="obs${p.id}">Comentario o aclaración del auditor sobre #${p.id}</label>
      <textarea id="obs${p.id}" data-obs="${p.id}" rows="2" maxlength="500" placeholder="${na ? 'Indique por qué no aplica (recomendado)' : 'Detalle lo observado, la ubicación o una aclaración'}">${esc(texto)}</textarea>
    </details>`;
}

/** Botón «No aplica / No posee» para las preguntas numéricas y de texto. */
function botonNoAplica(p, v) {
  if (!p.admiteNA || p.opciones) return '';
  const on = v === VALOR_NA;
  return `<button type="button" class="boton-na ${on ? 'sel' : ''}" data-na="${p.id}" aria-pressed="${on}">${on ? icono('Check') : ''}${TEXTO_NA}</button>`;
}

function renderPregunta(p, resp) {
  if (p.id === 1 && actual) return renderInstitucion(p);
  const v = resp[p.id];
  const na = v === VALOR_NA;
  const visible = preguntaVisible(p, resp);
  const cab = `<div class="p-cab"><span class="p-id">#${p.id}</span>${p.critica ? `<span class="p-critica">${icono('TriangleAlert')} Pregunta crítica</span>` : ''}${p.requerido ? '<span class="p-req">Requerida</span>' : ''}</div>
    <label class="p-texto" for="q${p.id}" id="lbl${p.id}">${esc(p.texto)}</label>`;
  let cuerpo = '';

  if (p.tipo === 'text') {
    const tipoInput = p.formato === 'email' ? 'email' : p.formato === 'tel' ? 'tel' : 'text';
    cuerpo = p.multilinea
      ? `<textarea id="q${p.id}" data-q="${p.id}" rows="6" placeholder="${esc(p.placeholder || '')}" ${na ? 'disabled' : ''}>${na ? '' : esc(v || '')}</textarea>`
      : `<input id="q${p.id}" data-q="${p.id}" type="${tipoInput}" ${p.formato === 'fecha' ? 'inputmode="numeric" maxlength="10"' : ''} placeholder="${esc(p.placeholder || '')}" value="${na ? '' : esc(v || '')}" ${na ? 'disabled' : ''} autocomplete="off">`;
    cuerpo += botonNoAplica(p, v);
  } else if (p.tipo === 'number') {
    cuerpo = `<div class="num">
      <button type="button" class="num-btn" data-paso="-1" data-q="${p.id}" aria-label="Restar" ${na ? 'disabled' : ''}>−</button>
      <input id="q${p.id}" data-q="${p.id}" type="number" inputmode="numeric" min="0" step="1" placeholder="${na ? '—' : '0'}" value="${na ? '' : v ?? ''}" ${na ? 'disabled' : ''}>
      <button type="button" class="num-btn" data-paso="1" data-q="${p.id}" aria-label="Sumar" ${na ? 'disabled' : ''}>+</button></div>
      ${botonNoAplica(p, v)}
      ${p.placeholder ? `<small class="ayuda">${esc(p.placeholder)}</small>` : ''}
      <div class="aviso-cons" id="cons${p.id}" hidden></div>`;
  } else if (p.tipo === 'single_choice') {
    cuerpo = `<div class="opciones" role="radiogroup" aria-labelledby="lbl${p.id}">${p.opciones.map(o => `
      <button type="button" role="radio" aria-checked="${v === o.valor}" class="opcion ${v === o.valor ? 'sel' : ''} ${o.incidencia?.killSwitch ? 'opc-ks' : ''} ${o.noAplica ? 'opc-na' : ''}" data-q="${p.id}" data-v="${esc(o.valor)}">
        <span class="radio"></span><span class="opc-txt">${esc(o.texto)}${o.incidencia ? `<br>${etiquetaInc(o.incidencia)}` : ''}${o.incidencia?.killSwitch ? `<span class="marca-ks">${icono('Siren')} KILL-SWITCH</span>` : ''}</span>
      </button>`).join('')}</div>`;
  } else if (p.tipo === 'multiple_choice') {
    const set = new Set(Array.isArray(v) ? v : []);
    cuerpo = `<div class="chips">${p.opciones.map(o => `
      <button type="button" role="checkbox" aria-checked="${set.has(o.valor)}" class="chip ${set.has(o.valor) ? 'sel' : ''} ${o.noAplica ? 'chip-na' : ''}" data-q="${p.id}" data-m="${esc(o.valor)}">${set.has(o.valor) ? icono('Check') : ''}${esc(o.texto)}</button>`).join('')}</div>`;
  } else if (p.tipo === 'rating_5') {
    cuerpo = `<div class="rating" role="radiogroup" aria-labelledby="lbl${p.id}">${p.opciones.map(o => `
      <button type="button" role="radio" aria-checked="${v === o.valor}" class="niv niv-${o.noAplica ? 'na' : o.valor} ${v === o.valor ? 'sel' : ''}" data-q="${p.id}" data-v="${esc(o.valor)}">
        <span class="niv-nombre">${o.noAplica ? '' : `<b>${o.valor}</b>`}${esc(o.texto)}</span>
        <span class="niv-desc">${esc(o.rubrica)}</span>
        ${o.incidencia ? `<span class="niv-inc">→ ${etiquetaInc(o.incidencia)}${o.incidencia.killSwitch ? `<span class="marca-ks">${icono('Siren')} KILL-SWITCH</span>` : ''}</span>` : ''}
      </button>`).join('')}</div>`;
  }
  return `<article class="pregunta ${visible ? '' : 'oculta'} ${esNoAplica(p, v) ? 'es-na' : ''}" id="p${p.id}" data-id="${p.id}" ${visible ? '' : 'hidden'}>${cab}${cuerpo}${renderObservacion(p, v)}</article>`;
}

function cabeceraRelevamiento() {
  const res = actual.resultado || calcularIES(actual.respuestas);
  const ks = res.killSwitches.length;
  return `<header class="barra barra-rel"><div class="barra-interior">
      <a class="btn-ico" href="#/" aria-label="Volver al inicio">${icono('ChevronLeft')}</a>
      <div class="rel-tit"><strong>${esc(nombreDe(actual))}</strong><small id="ind-guardado">Guardado en el dispositivo</small></div>
      <a href="#/r/${actual.id}/resultado" class="ies-live c-${claseIES(res)}" id="ies-live" aria-label="Ver resultado">
        <span>IES</span><b>${res.ies == null ? '—' : res.ies}</b></a>
    </div></header>
    <div class="ks-banda alerta-roja" id="ks-banda" ${ks ? '' : 'hidden'}><div class="barra-interior">${icono('Siren')} <span id="ks-texto">${ks} Kill-Switch activo(s): Alerta Roja Crítica</span></div></div>`;
}

function vistaSeccion(n) {
  const s = SECCIONES.find(x => x.n === n) || SECCIONES[0];
  const resp = actual.respuestas;
  // Memoria de trabajo: dónde quedó el auditor y qué día trabajó (sólo en borradores).
  if (actual.estado === 'borrador' && (actual.ultimaSeccion !== s.n || !actual.jornadas?.some(j => j.fecha === fechaLocal()))) {
    actual.ultimaSeccion = s.n; registrarJornada(actual, s.n); db.guardar(actual);
  }
  pintarVista(cabeceraRelevamiento(), `
    <nav class="secciones" aria-label="Secciones del formulario">${SECCIONES.map(x => {
      const pr = progresoSeccion(x, resp);
      const completa = pr.total && pr.ok === pr.total;
      return `<a href="#/r/${actual.id}/s/${x.n}" class="sec-chip ${x.n === s.n ? 'activa' : ''} ${completa ? 'completa' : ''}" aria-current="${x.n === s.n ? 'step' : 'false'}" title="${esc(x.titulo)}">
        ${icono(x.icono)}<span>${x.n}</span></a>`; }).join('')}
    </nav>
      <section class="sec-cab">
        <div class="sec-ico">${icono(s.icono)}</div>
        <div><small>Sección ${s.n} de ${SECCIONES.length}</small><h2>${esc(s.titulo)}</h2><p>${esc(s.descripcion)}</p></div>
      </section>
      <form id="form" novalidate onsubmit="return false">${s.preguntas.map(p => renderPregunta(p, resp)).join('')}</form>
      <div class="navegacion">
        ${s.n > 1 ? `<a class="boton boton--secundario" href="#/r/${actual.id}/s/${s.n - 1}">${icono('ChevronLeft')} Anterior</a>` : '<span></span>'}
        ${s.n < SECCIONES.length
          ? `<a class="boton boton--primario" href="#/r/${actual.id}/s/${s.n + 1}">Siguiente ${icono('ChevronRight')}</a>`
          : `<a class="boton boton--primario" href="#/r/${actual.id}/resultado">Ver resultado ${icono('ChevronRight')}</a>`}
      </div>`);
  enlazarFormulario(s);
  revisarConsistencia();
}

function enlazarFormulario(s) {
  const form = document.getElementById('form');

  form.addEventListener('input', e => {
    if (e.target.dataset.obs) { establecerObservacion(Number(e.target.dataset.obs), e.target.value); return; }
    const q = e.target.dataset.q; if (!q) return;
    let val = e.target.value;
    if (e.target.type === 'number') val = val === '' ? '' : Math.max(0, parseInt(val, 10) || 0);
    if (PREGUNTAS.get(Number(q)).formato === 'fecha') {
      const d = val.replace(/\D/g, '').slice(0, 8);
      val = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
      e.target.value = val;
    }
    establecer(Number(q), val, false);
  });

  form.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sede != null) {
      actual.institucion.direccion = actual.institucion.direcciones[Number(b.dataset.sede)];
      b.parentElement.querySelectorAll('button').forEach(x => { const on = x === b; x.classList.toggle('sel', on); x.setAttribute('aria-checked', on); });
      guardarDiferido(); return;
    }
    if (b.dataset.na) { alternarNoAplica(Number(b.dataset.na)); return; }
    const q = Number(b.dataset.q);
    if (b.dataset.paso) {
      const inp = document.getElementById('q' + q);
      const nv = Math.max(0, (parseInt(inp.value, 10) || 0) + Number(b.dataset.paso));
      inp.value = nv; establecer(q, nv, false); return;
    }
    if (b.dataset.m != null) {
      let set = new Set(Array.isArray(actual.respuestas[q]) ? actual.respuestas[q] : []);
      set.has(b.dataset.m) ? set.delete(b.dataset.m) : set.add(b.dataset.m);
      // «No aplica» excluye al resto de las opciones, y viceversa.
      if (b.dataset.m === VALOR_NA && set.has(VALOR_NA)) set = new Set([VALOR_NA]);
      else if (b.dataset.m !== VALOR_NA) set.delete(VALOR_NA);
      b.parentElement.querySelectorAll('button[data-m]').forEach(x => {
        const on = set.has(x.dataset.m);
        x.classList.toggle('sel', on); x.setAttribute('aria-checked', on);
        x.innerHTML = (on ? icono('Check') : '') + esc(textoSinIcono(x));
      });
      establecer(q, [...set], false); marcarNoAplica(q); return;
    }
    if (b.dataset.v != null) {
      const ya = actual.respuestas[q] === b.dataset.v;
      const nuevo = ya ? '' : b.dataset.v; // un segundo toque deselecciona
      b.parentElement.querySelectorAll('button').forEach(x => { const on = x === b && !ya; x.classList.toggle('sel', on); x.setAttribute('aria-checked', on); });
      establecer(q, nuevo, true);
      marcarNoAplica(q);
      if (!ya) {
        const o = PREGUNTAS.get(q).opciones.find(x => x.valor === nuevo);
        if (o?.incidencia?.killSwitch) {
          navigator.vibrate?.([120, 60, 120]);
          aviso(`${icono('Siren')} <b>KILL-SWITCH activado:</b> ${esc(o.incidencia.killSwitch)}`, 'roja', 5000);
        }
      }
    }
  });
}

/** Activa o desactiva «No aplica» en una pregunta numérica o de texto. */
function alternarNoAplica(id) {
  const on = actual.respuestas[id] !== VALOR_NA;
  establecer(id, on ? VALOR_NA : '', true);
  const art = document.getElementById('p' + id);
  art.querySelectorAll('[data-q]').forEach(el => { el.disabled = on; if (on && 'value' in el && el.tagName !== 'BUTTON') el.value = ''; });
  const b = art.querySelector('[data-na]');
  b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on);
  b.innerHTML = (on ? icono('Check') : '') + TEXTO_NA;
  marcarNoAplica(id);
}

/** Con «No aplica» se abre la observación para justificarlo. */
function marcarNoAplica(id) {
  const p = PREGUNTAS.get(id);
  const na = esNoAplica(p, actual.respuestas[id]);
  const art = document.getElementById('p' + id); if (!art) return;
  art.classList.toggle('es-na', na);
  const det = document.getElementById('obs-' + id), ta = document.getElementById('obs' + id);
  if (det && ta) {
    ta.placeholder = na ? 'Indique por qué no aplica (recomendado)' : 'Detalle lo observado, la ubicación o una aclaración';
    if (na) det.open = true;
  }
}

function establecerObservacion(id, texto) {
  const limpio = texto.trim();
  if (limpio) actual.observaciones[id] = texto.slice(0, 500); else delete actual.observaciones[id];
  const marca = document.querySelector(`#obs-${id} .obs-tiene`);
  const sum = document.querySelector(`#obs-${id} summary`);
  if (limpio && !marca && sum) sum.insertAdjacentHTML('beforeend', ' <span class="obs-tiene">· cargada</span>');
  if (!limpio && marca) marca.remove();
  const ind = document.getElementById('ind-guardado');
  if (ind) { ind.textContent = 'Guardando…'; ind.classList.remove('ok'); }
  guardarDiferido();
}

function establecer(id, valor, reevaluarVisibilidad) {
  if (valor === '' || (Array.isArray(valor) && !valor.length)) delete actual.respuestas[id];
  else actual.respuestas[id] = valor;
  registrarJornada(actual, PREGUNTAS.get(id)?.seccion);
  const ind = document.getElementById('ind-guardado');
  if (ind) { ind.textContent = 'Guardando…'; ind.classList.remove('ok'); }
  actual.resultado = calcularIES(actual.respuestas);
  refrescarCabecera();
  if (reevaluarVisibilidad) {
    document.querySelectorAll('.pregunta').forEach(el => {
      const p = PREGUNTAS.get(Number(el.dataset.id)); const vis = preguntaVisible(p, actual.respuestas);
      el.hidden = !vis;
    });
  }
  revisarConsistencia();
  guardarDiferido();
}

function refrescarCabecera() {
  const res = actual.resultado;
  const live = document.getElementById('ies-live');
  if (live) { live.className = `ies-live c-${claseIES(res)}`; live.querySelector('b').textContent = res.ies == null ? '—' : res.ies; }
  const banda = document.getElementById('ks-banda');
  if (banda) { banda.hidden = !res.killSwitches.length; banda.querySelector('#ks-texto').textContent = `${res.killSwitches.length} Kill-Switch activo(s): Alerta Roja Crítica`; }
  const t = document.querySelector('.rel-tit strong'); if (t) t.textContent = nombreDe(actual);
  document.querySelectorAll('.sec-chip').forEach((a, i) => {
    const pr = progresoSeccion(SECCIONES[i], actual.respuestas);
    a.classList.toggle('completa', !!pr.total && pr.ok === pr.total);
  });
}

function revisarConsistencia() {
  document.querySelectorAll('.aviso-cons').forEach(el => { el.hidden = true; });
  for (const a of validarConsistencia(actual.respuestas)) {
    const el = document.getElementById('cons' + a.id);
    if (el) { el.hidden = false; el.innerHTML = `${icono('TriangleAlert')} ${esc(a.mensaje)}`; }
  }
}

/* ================= Vista: Resultado ================= */

function vistaResultado() {
  const res = actual.resultado = calcularIES(actual.respuestas);
  const faltan = faltantesRequeridas(actual.respuestas);
  const cons = validarConsistencia(actual.respuestas);
  // «No aplica» en preguntas críticas sin justificación: aviso para el auditor (no bloquea).
  const naSinJustificar = res.noAplica.filter(x => x.critica && !actual.observaciones?.[x.idPregunta]);
  const porJur = j => res.incidencias.filter(i => i.jurisdiccion === j);
  const tabla = lista => lista.length ? `<ul class="incs">${lista.map(i => `
      <li class="${i.killSwitch ? 'es-ks' : ''}">
        <div class="incs-top"><a href="#/r/${actual.id}/s/${i.seccion}">#${i.idPregunta}</a> ${etiquetaInc(i)}</div>
        <div class="incs-desc">${esc(i.killSwitch ? i.motivoKillSwitch : i.descripcion)}</div>
        <div class="incs-preg">${esc(i.pregunta)} — <em>${esc(i.respuesta)}</em></div>
      </li>`).join('')}</ul>` : '<p class="sutil">Sin incidencias en esta jurisdicción.</p>';

  pintarVista(cabeceraRelevamiento(), `
      <section class="res-cab c-${res.clasificacion.clase}">
        <div class="res-num"><small>Índice de Estado de Infraestructura Escolar</small>
          <b>${res.ies}</b><span>/ 100</span></div>
        <div class="res-clas">${esc(res.clasificacion.etiqueta)}${res.clasificacion.forzadaPorKillSwitch ? ' <small>(clasificación forzada por Kill-Switch)</small>' : ''}</div>
        ${res.killSwitches.length ? `<p class="res-nota">Puntaje base ${res.iesBase.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} × multiplicador ${res.multiplicador.toLocaleString('es-AR')} (${res.killSwitches.length} Kill-Switch activo${res.killSwitches.length > 1 ? 's' : ''}).</p>` : ''}
        ${res.dimensionesCompletas < DIMENSIONES.length ? `<p class="res-nota">${res.dimensionesCompletas} de ${DIMENSIONES.length} dimensiones completas. Las dimensiones incompletas valen 0 puntos hasta terminar su evaluación.</p>` : ''}
        ${res.excepcionHidraulica ? '<p class="res-nota">Subida directa de red: la falta de bombas (#91) no genera incidencia.</p>' : ''}
        <div class="avance"><div style="width:${res.avance.porcentaje}%"></div></div>
        <small>${res.avance.respondidas} de ${res.avance.aplicables} preguntas respondidas (${res.avance.porcentaje}%)</small>
      </section>

      ${res.killSwitches.length ? `<section class="bloque bloque-ks alerta-roja"><h2>${icono('Siren')} Alerta Roja Crítica</h2>
        <ul>${res.killSwitches.map(k => `<li><b>#${k.idPregunta}</b> ${esc(k.motivoKillSwitch)} <small>(${k.jurisdiccion === 'PROVINCIA_MAYOR' ? 'Provincia' : 'FoDeMEEP'})</small></li>`).join('')}</ul>
        <p>Requiere intervención inmediata y comunicación a la autoridad escolar.</p></section>` : ''}

      ${faltan.length || cons.length || naSinJustificar.length ? `<section class="bloque bloque-aviso">
        ${faltan.map(p => `<p>${icono('TriangleAlert')} Falta completar <a href="#/r/${actual.id}/s/${p.seccion}">#${p.id} ${esc(p.texto)}</a> (requerida).</p>`).join('')}
        ${cons.map(c => `<p>${icono('TriangleAlert')} ${esc(c.mensaje)}</p>`).join('')}
        ${naSinJustificar.map(x => `<p>${icono('TriangleAlert')} Pregunta crítica marcada «No aplica» sin observación: <a href="#/r/${actual.id}/s/${x.seccion}">#${x.idPregunta} ${esc(x.pregunta)}</a>. Conviene justificarla.</p>`).join('')}</section>` : ''}
      ${res.noAplica.length ? `<p class="sutil nota-na">${res.noAplica.length} respuesta${res.noAplica.length > 1 ? 's' : ''} «${TEXTO_NA}»: no generan incidencias ni puntos.</p>` : ''}

      <section class="bloque"><h2>Subíndices por dimensión</h2>
        <div class="dims">${res.dimensiones.map(d => `
          <div class="dim">
            <div class="dim-top"><span>${esc(d.nombre)} <small>peso ${d.peso}%</small></span>
              <span class="dim-val"><span class="estado-dim e-${d.claseEstado}">${esc(d.estado)}</span><b>${d.puntaje}</b></span></div>
            <div class="dim-barra"><div class="b-${d.claseEstado}" style="width:${d.puntaje}%"></div></div>
            ${d.completa ? '' : `<small class="dim-falta">Faltan preguntas: ${d.cualitativasRespondidas} de ${d.cualitativasTotal} esenciales respondidas · <a href="#/r/${actual.id}/s/${DIMENSIONES.find(x => x.id === d.id).secciones.find(n => { const s = SECCIONES.find(z => z.n === n); return s.preguntas.some(p => preguntaVisible(p, actual.respuestas) && (actual.respuestas[p.id] == null || actual.respuestas[p.id] === '')); }) || DIMENSIONES.find(x => x.id === d.id).secciones[0]}">completar</a></small>`}
          </div>`).join('')}</div>
      </section>

      <section class="bloque"><h2>Incidencias detectadas <span class="cuenta">${res.incidencias.length}</span></h2>
        <h3>${JUR_TXT.FoDeMEEP} <span class="cuenta">${porJur('FoDeMEEP').length}</span></h3>${tabla(porJur('FoDeMEEP'))}
        <h3>${JUR_TXT.PROVINCIA_MAYOR} <span class="cuenta">${porJur('PROVINCIA_MAYOR').length}</span></h3>${tabla(porJur('PROVINCIA_MAYOR'))}
      </section>

      <section class="bloque acciones-fin">
        <button class="boton boton--primario boton--grande boton--ancho" id="finalizar" ${faltan.length ? 'disabled' : ''}>${icono('CloudUpload')} ${actual.estado === 'sincronizado' ? 'Reenviar a la planilla central' : 'Finalizar y enviar'}</button>
        <div class="fila-acciones">
          <button class="boton boton--secundario" id="exp-json">${icono('Download')} Respaldo JSON</button>
          <button class="boton boton--secundario" id="exp-csv">${icono('FileText')} Incidencias CSV</button>
        </div>
        <button class="boton boton--peligro" id="eliminar">${icono('Trash2')} Eliminar del dispositivo</button>
      </section>`);

  db.guardar(actual);

  document.getElementById('finalizar').onclick = async () => {
    actual.estado = 'finalizado';
    actual.finalizado = actual.finalizado || new Date().toISOString();
    await db.guardar(actual);
    if (!navigator.onLine) { aviso(`${icono('WifiOff')} Sin conexión. Quedó en cola y se enviará automáticamente.`, 'info', 4500); location.hash = '#/'; return; }
    try {
      await sincronizarUno(actual, await obtenerConfig());
      aviso(`${icono('Check')} Relevamiento enviado a la planilla central.`, 'ok');
    } catch (e) {
      actual.errorSync = e.message; await db.guardar(actual);
      aviso(`${icono('TriangleAlert')} Quedó pendiente de envío: ${esc(e.message)}`, 'error', 5000);
    }
    location.hash = '#/';
  };
  document.getElementById('exp-json').onclick = () => descargar(`relevamiento-${slug()}.json`, JSON.stringify(actual, null, 2), 'application/json');
  document.getElementById('exp-csv').onclick = () => {
    const cab = ['id_relevamiento', 'establecimiento', 'id_pregunta', 'seccion', 'tipo', 'criticidad', 'jurisdiccion', 'puntos', 'kill_switch', 'descripcion'];
    const filas = res.incidencias.map(i => [actual.id, nombreDe(actual), i.idPregunta, i.seccion, i.tipo, i.criticidad, i.jurisdiccion, i.puntos, i.killSwitch ? 'SI' : 'NO', i.killSwitch ? i.motivoKillSwitch : i.descripcion]);
    const csv = [cab, ...filas].map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    descargar(`incidencias-${slug()}.csv`, '﻿' + csv, 'text/csv');
  };
  document.getElementById('eliminar').onclick = async e => {
    const b = e.currentTarget;
    if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.innerHTML = `${icono('Trash2')} Tocar de nuevo para confirmar`; return; }
    await db.eliminar(actual.id); actual = null; aviso('Relevamiento eliminado del dispositivo.'); location.hash = '#/';
  };
}

const slug = () => nombreDe(actual).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase();
function descargar(nombre, contenido, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ================= Vista: Configuración ================= */

/* ================= Respaldo completo del dispositivo ================= */

async function descargarRespaldo() {
  const lista = await db.listar();
  const paquete = { tipo: 'respaldo-fodemeep', version: 1, catalogo: VERSION_CATALOGO, generado: new Date().toISOString(), relevamientos: lista };
  descargar(`respaldo-fodemeep-${fechaLocal()}.json`, JSON.stringify(paquete, null, 1), 'application/json');
  const el = document.getElementById('resp-estado');
  if (el) el.textContent = `Respaldo descargado: ${lista.length} relevamiento${lista.length === 1 ? '' : 's'}. Guardalo en un lugar seguro (por ejemplo, Google Drive).`;
}

/** Restaura un respaldo: agrega los relevamientos que faltan y, si ya existen, conserva la versión más reciente. */
async function restaurarRespaldo(archivo) {
  const el = document.getElementById('resp-estado');
  try {
    const datos = JSON.parse(await archivo.text());
    if (datos.tipo !== 'respaldo-fodemeep' || !Array.isArray(datos.relevamientos)) throw new Error('El archivo no es un respaldo de esta aplicación.');
    let nuevos = 0, actualizados = 0, sinCambios = 0;
    for (const r of datos.relevamientos) {
      if (!r?.id || !r.respuestas) continue;
      const local = await db.obtener(r.id);
      if (!local) { await db.guardar(r); nuevos++; }
      else if ((r.actualizado || '') > (local.actualizado || '')) { await db.guardar(r); actualizados++; }
      else sinCambios++;
    }
    const msg = `Respaldo restaurado: ${nuevos} nuevo${nuevos === 1 ? '' : 's'}, ${actualizados} actualizado${actualizados === 1 ? '' : 's'}, ${sinCambios} sin cambios.`;
    if (el) el.textContent = msg;
    aviso(`${icono('Check')} ${msg}`, 'ok', 5000);
  } catch (e) {
    if (el) el.textContent = '';
    aviso(`${icono('TriangleAlert')} No se pudo restaurar: ${esc(e.message)}`, 'error', 5000);
  }
}

async function vistaConfig() {
  const cfg = await obtenerConfig();
  pintarVista(`
    <header class="barra"><div class="barra-interior"><a class="btn-ico" href="#/" aria-label="Volver">${icono('ChevronLeft')}</a>
      <div class="rel-tit"><strong>Configuración</strong><small>Conexión con la planilla central</small></div></div></header>`, `
      <form id="cfg" class="bloque" onsubmit="return false">
        <label class="p-texto" for="url">URL de la aplicación web (Apps Script)</label>
        <input id="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url)}">
        <label class="p-texto" for="token">Clave de acceso del equipo</label>
        <input id="token" type="password" value="${esc(cfg.token)}" autocomplete="off">
        <label class="p-texto" for="tecnico">Técnico/a por defecto (precarga la pregunta #3)</label>
        <input id="tecnico" type="text" placeholder="Ej: Arq. Técnico Municipal FoDeMEEP" value="${esc(cfg.tecnico)}">
        <div class="fila-acciones">
          <button class="boton boton--primario" id="guardar">${icono('Check')} Guardar</button>
          <button class="boton boton--secundario" id="probar">${icono('RefreshCw')} Probar conexión</button>
        </div>
      </form>
      <section class="bloque" id="respaldo"><h2>Respaldo de los relevamientos</h2>
        <p class="sutil">Descarga en un archivo todos los relevamientos de este celular (en curso, pendientes y enviados), con sus respuestas, observaciones y jornadas de trabajo. Sirve para cambiar de teléfono o como resguardo antes de borrar datos del navegador.</p>
        <div class="fila-acciones">
          <button class="boton boton--secundario" id="resp-bajar">${icono('Download')} Descargar respaldo completo</button>
          <label class="boton boton--secundario" for="resp-subir">${icono('Upload')} Restaurar desde un respaldo</label>
          <input id="resp-subir" type="file" accept="application/json,.json" class="oculto-archivo">
        </div>
        <p class="sutil" id="resp-estado"></p>
      </section>
      <section class="bloque"><h2>Metodología del IES</h2>
        <ul class="pesos">${DIMENSIONES.map(d => `<li><span>${d.id} · ${esc(d.nombre)}<small>Secciones ${d.secciones.join(', ')} · piso ${d.piso} pts</small></span><b>${d.peso}%</b></li>`).join('')}</ul>
        <p class="sutil">Cada Kill-Switch multiplica el índice por ${PARAMETROS_IES.factorKillSwitch.CRITICA.toLocaleString('es-AR')} (criticidad CRÍTICA) o ${PARAMETROS_IES.factorKillSwitch.OTRA.toLocaleString('es-AR')} (otras) y fuerza la clasificación «Crítico». Clasificación: Óptimo ≥ 85 · Bueno 70–84 · Regular 50–69 · Crítico &lt; 50.</p>
      </section>`);
  document.getElementById('resp-bajar').onclick = descargarRespaldo;
  document.getElementById('resp-subir').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) restaurarRespaldo(f); };
  const leer = () => ({ url: document.getElementById('url').value.trim(), token: document.getElementById('token').value.trim(), tecnico: document.getElementById('tecnico').value.trim() });
  document.getElementById('guardar').onclick = async () => { await db.escribirConfig('servidor', leer()); aviso(`${icono('Check')} Configuración guardada.`, 'ok'); };
  document.getElementById('probar').onclick = async () => {
    const c = leer();
    if (!c.url) return aviso('Ingrese la URL del servicio.', 'error');
    try {
      const r = await fetch(`${c.url}?accion=ping&token=${encodeURIComponent(c.token)}`);
      const j = await r.json();
      j.ok ? aviso(`${icono('Check')} Conexión correcta con «${esc(j.planilla || 'planilla central')}».`, 'ok') : aviso(esc(j.error || 'Error de autenticación.'), 'error');
    } catch (e) { aviso(`No se pudo conectar: ${esc(e.message)}`, 'error'); }
  };
}

/* ================= Arranque ================= */

function estadoRed() {
  document.body.classList.toggle('sin-red', !navigator.onLine);
}
window.addEventListener('online', () => { estadoRed(); sincronizarPendientes().then(({ enviados }) => { if (enviados) { aviso(`${icono('Check')} Conexión restablecida: ${enviados} relevamiento(s) enviados.`, 'ok'); if (location.hash === '#/' || !location.hash) vistaInicio(); } }); });
window.addEventListener('offline', estadoRed);
window.addEventListener('hashchange', enrutar);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) aviso('Hay una nueva versión disponible. Se aplicará al reabrir la aplicación.', 'info', 6000);
      });
    });
  }).catch(() => {});
}
navigator.storage?.persist?.();

estadoRed();
enrutar();
if (navigator.onLine) sincronizarPendientes().then(() => {
  if (!location.hash || location.hash === '#/') vistaInicio(); // refleja el padrón actualizado
}).catch(() => {});
