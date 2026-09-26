# D.E.N.N.I.S.

**D**irectory **E**xclusion for **N**o-**N**onsense **I**ndividual **S**creening

Extensión de VSCode que muestra, en un panel lateral propio, **solo los
archivos que necesitas para el "espacio" en el que estás trabajando**
(test, auth, pagos, etc), en vez de todo el árbol del proyecto.

## Cómo probarla (sin publicarla todavía)

1. Abre esta carpeta en VSCode.
2. Ejecuta `npm install` (instala solo los tipos de VSCode, no hay
   dependencias de runtime).
3. Presiona `F5`. Esto abre una segunda ventana de VSCode
   ("Extension Development Host") con la extensión ya cargada.
4. En esa segunda ventana, abre CUALQUIER carpeta de proyecto real
   (la tuya, donde tienes `src/pages/pagePanel`, etc).
5. En la barra de actividad (el margen izquierdo con íconos) verás un
   nuevo ícono de "D.E.N.N.I.S.". Ábrelo.

## Flujo de uso

Hay **3 formas** de agregar un archivo a un espacio:

1. **Clic derecho en el Explorador** sobre una carpeta o archivo
   → **"D.E.N.N.I.S.: Agregar a espacio..."**
2. **Clic derecho DENTRO del editor**, con el archivo abierto
   → mismo menú, mismo comando.
3. **Atajo de teclado** `Ctrl+Alt+D` (`Cmd+Alt+D` en Mac) con el
   cursor dentro de un archivo abierto: agrega ese archivo activo
   sin necesidad de tocar el mouse.

Cualquiera de las 3 formas abre el mismo selector:

1. Elige "Crear nuevo espacio" y escribe, por ejemplo, `test`.
2. Repite para cada archivo/carpeta que quieras fijar a ese espacio
   (por ejemplo `src/pages/pagePanel`, y luego el archivo puntual
   dentro de `node_modules` que necesites).
3. En el panel "Espacios", usa el ícono de lista (arriba a la
   derecha del panel) → **"Seleccionar espacio"** para cambiar entre
   `test`, `auth`, etc. El panel se actualiza mostrando SOLO
   las rutas fijadas a ese espacio.
4. Para quitar algo de un espacio, clic derecho sobre el ítem dentro
   del panel → "Quitar de este espacio".

El título del panel cambia dinámicamente según el espacio activo,
por ejemplo: `D.E.N.N.I.S. : test`. Si no hay ninguno activo,
muestra `D.E.N.N.I.S. (sin espacio activo)`.

> Nota sobre el atajo `Ctrl+Alt+D`: si ya usas esa combinación para
> otra cosa en tu VSCode, puedes cambiarla libremente desde
> `Preferencias > Atajos de teclado`, buscando "D.E.N.N.I.S.".

## Dónde se guarda la configuración

En `.vscode/file-modes.json` dentro del proyecto que abras. Es un
JSON legible y editable a mano si quieres (el nombre interno del
archivo y de las claves sigue siendo "mode" por temas de código,
pero conceptualmente representa tus "espacios"):

```json
{
  "activeMode": "analitica",
  "modes": {
    "analitica": [
      "src/pages/analitica",
      "node_modules/chart.js/dist/chart.js"
    ],
    "auth": [
      "src/pages/login",
      "src/services/auth.service.js"
    ]
  }
}
```

