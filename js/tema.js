/* ==========================================================================
   tema.js — Interruptor de modo claro/oscuro. NO se toca.

   Sin este botón, el tablero ya sigue el modo del sistema operativo del
   visitante (ver css/tokens.css). Este script permite ELEGIR uno a mano
   (queda guardado en ese navegador, en localStorage) y avisa a los gráficos
   para que se redibujen con los colores correctos al cambiar.
   ========================================================================== */

(function () {
  const CLAVE = 'tablero-tema';

  function guardar(valor) {
    try { localStorage.setItem(CLAVE, valor); } catch (e) { /* modo privado, etc. */ }
  }
  function sistemaPrefiereOscuro() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  /** El tema realmente activo ahora mismo: lo elegido a mano, o si no, el del sistema. */
  function actual() {
    const elegido = document.documentElement.getAttribute('data-tema');
    if (elegido === 'claro' || elegido === 'oscuro') { return elegido; }
    return sistemaPrefiereOscuro() ? 'oscuro' : 'claro';
  }
  function alternar() {
    const siguiente = actual() === 'oscuro' ? 'claro' : 'oscuro';
    document.documentElement.setAttribute('data-tema', siguiente);
    guardar(siguiente);
    sincronizarBoton();
    // Otras partes de la página (por ejemplo guia-diseno.html) pueden
    // escuchar este evento para actualizarse cuando cambia el tema.
    document.dispatchEvent(new CustomEvent('tema:cambio', { detail: { tema: siguiente } }));
  }

  function sincronizarBoton() {
    const boton = document.getElementById('boton-tema');
    if (!boton) { return; }
    const oscuro = actual() === 'oscuro';
    boton.classList.toggle('es-oscuro', oscuro);
    boton.setAttribute('aria-pressed', String(oscuro));
  }

  document.addEventListener('DOMContentLoaded', function () {
    const boton = document.getElementById('boton-tema');
    if (boton) { boton.addEventListener('click', alternar); }
    sincronizarBoton();
  });

  // Si nadie eligió a mano y el sistema operativo cambia de tema en vivo
  // (por ejemplo, el modo automático del sistema al atardecer), el ícono
  // se actualiza solo.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sincronizarBoton);
  }

  window.Tema = { actual: actual, alternar: alternar };
})();
