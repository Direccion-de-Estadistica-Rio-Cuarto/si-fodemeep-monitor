/* ==========================================================================
   tablero.js — Punto de entrada de la lógica (estructura de la plantilla).

   El SI FoDeMEEP tiene dos páginas con lógica propia, escritas como módulos:
   - index.html   → js/app.js           PWA de relevamiento en campo
   - monitor.html → monitor/monitor.js  Monitor Ejecutivo

   Cada página declara cuál es con <body data-pagina="…"> y este archivo carga
   el módulo que corresponde. Así las dos páginas cumplen la estructura de la
   plantilla (tema.js + tablero.js) sin mezclar su código.
   ========================================================================== */

const MODULOS = {
  relevamiento: () => import('./app.js'),
  monitor: () => import('../monitor/monitor.js'),
};

const pagina = document.body.dataset.pagina || 'relevamiento';

(MODULOS[pagina] || MODULOS.relevamiento)().catch(error => {
  // Mismo mensaje de error que la plantilla (.error de base.css).
  const destino = document.getElementById('app');
  if (destino) {
    destino.innerHTML = '<div class="error"><strong>No se pudo iniciar la aplicación.</strong><br>'
      + String(error && error.message || error).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      + '</div>';
  }
});
