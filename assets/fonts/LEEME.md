# assets/fonts/ — tipografía e íconos, guardados en el repo

## material-symbols-outlined.woff2

- **Qué es:** [Material Symbols](https://fonts.google.com/icons) de Google,
  estilo "Outlined", peso 400. Un solo archivo cubre TODOS los íconos de la
  librería (varios miles) — se usan por nombre, como texto (ver `css/iconos.css`).
- **Licencia:** Apache License 2.0 — de uso y redistribución libres.
- No se carga de internet: por eso está acá.

### Para actualizarla (solo quien mantiene el template)

```bash
curl -sL "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" \
  -A "Mozilla/5.0" | grep -o 'https://fonts.gstatic.com[^)]*' | head -1
# Descargar esa URL a assets/fonts/material-symbols-outlined.woff2
```

---

## google-sans-latin-variable.woff2

- **Qué es:** Google Sans, la tipografía del equipo de estadísticas. Es una
  fuente **variable**: un solo archivo cubre todos los pesos entre 400
  (normal) y 700 (negrita).
- **Licencia:** SIL Open Font License 1.1 — de uso y redistribución libres
  (verificado en fonts.google.com/specimen/Google+Sans/license, agosto 2026).
- **Subconjunto:** solo caracteres latinos (incluye tildes, ñ, ¿, ¡). Si algún
  tablero necesita otro alfabeto, hay que sumar el subconjunto correspondiente.
- Se declara en `css/fuentes.css` y se usa en todo el tablero vía la variable
  `--fuente` de `css/tokens.css`. No se carga de internet: por eso está acá.
- **Nota:** el sitio oficial riocuarto.gob.ar usa Inter, no Google Sans — este
  tablero ya no coincide tipográficamente con la web del municipio a propósito
  (decisión del equipo, agosto 2026).

### Para actualizarla (solo quien mantiene el template)

```bash
curl -sL "https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&display=swap" \
  -A "Mozilla/5.0" | grep -A2 '/\* latin \*/' | grep -o 'https://fonts.gstatic.com[^)]*' | head -1
# Descargar esa URL a assets/fonts/google-sans-latin-variable.woff2
```
