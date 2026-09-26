const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

// Nombre del archivo donde guardamos la configuración de modos.
// Vive dentro de .vscode/ para que puedas versionarlo si quieres compartirlo con tu equipo.
const CONFIG_FILENAME = 'file-modes.json';

/**
 * Maneja la lectura/escritura del archivo de configuración de modos.
 * Estructura del JSON:
 * {
 *   "activeMode": "analitica",
 *   "modes": {
 *     "analitica": ["src/pages/analitica", "node_modules/chart.js/dist/chart.js"],
 *     "auth": ["src/pages/login", "src/services/auth.service.js"]
 *   }
 * }
 */
class ModeStore {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.configPath = path.join(workspaceRoot, '.vscode', CONFIG_FILENAME);
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      // Si no existe el archivo todavía, arrancamos con estructura vacía.
      return { activeMode: null, modes: {} };
    }
  }

  _save() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getModeNames() {
    return Object.keys(this.data.modes);
  }

  getActiveMode() {
    return this.data.activeMode;
  }

  setActiveMode(name) {
    this.data.activeMode = name;
    this._save();
  }

  createMode(name) {
    if (!this.data.modes[name]) {
      this.data.modes[name] = [];
      this._save();
    }
  }

  getPathsForMode(name) {
    return this.data.modes[name] || [];
  }

  addPathToMode(name, relativePath) {
    if (!this.data.modes[name]) {
      this.data.modes[name] = [];
    }
    if (!this.data.modes[name].includes(relativePath)) {
      this.data.modes[name].push(relativePath);
      this._save();
    }
  }

  removePathFromMode(name, relativePath) {
    if (!this.data.modes[name]) return;
    this.data.modes[name] = this.data.modes[name].filter((p) => p !== relativePath);
    this._save();
  }
}

/**
 * Un nodo del árbol: puede ser un archivo o una carpeta.
 * Si es carpeta, sus hijos se calculan leyendo el sistema de archivos real,
 * pero SOLO mostramos lo que está dentro de la ruta fijada (no todo el proyecto).
 */
class FileModeItem extends vscode.TreeItem {
  constructor(label, fullPath, isDirectory, collapsibleState) {
    super(label, collapsibleState);
    this.fullPath = fullPath;
    this.resourceUri = vscode.Uri.file(fullPath);
    this.contextValue = 'fileModesEntry'; // usado por el menú contextual (quitar de modo)

    if (!isDirectory) {
      // Al hacer click, abre el archivo como cualquier archivo del explorador.
      this.command = {
        command: 'vscode.open',
        title: 'Abrir archivo',
        arguments: [this.resourceUri]
      };
      this.iconPath = vscode.ThemeIcon.File;
    } else {
      this.iconPath = vscode.ThemeIcon.Folder;
    }
  }
}

/**
 * Nodo intermedio "virtual": representa una carpeta que NO fue fijada
 * directamente, sino que existe solo porque agrupa a uno o más archivos/
 * carpetas fijados que comparten ese ancestro (ej: "app" agrupa a
 * "app/main.py" y "app/testfile.py"). No corresponde 1:1 a una entrada
 * del JSON de configuración, por eso no se puede "quitar de modo"
 * directamente sobre ella.
 */
class VirtualFolderItem extends vscode.TreeItem {
  constructor(label, fullPath, childrenNode) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.fullPath = fullPath;
    this.childrenNode = childrenNode; // Map<string, node> con los hijos virtuales
    this.resourceUri = vscode.Uri.file(fullPath);
    this.iconPath = vscode.ThemeIcon.Folder;
    this.contextValue = 'fileModesVirtualFolder';
  }
}

class FileModesProvider {
  constructor(workspaceRoot, modeStore) {
    this.workspaceRoot = workspaceRoot;
    this.modeStore = modeStore;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    const activeMode = this.modeStore.getActiveMode();

    if (!activeMode) {
      // Sin modo activo: mostramos un item informativo, no lanzamos error.
      const info = new vscode.TreeItem('Ningún espacio activo. Usa "Seleccionar espacio".');
      info.contextValue = 'fileModesEmpty';
      return [info];
    }

    if (!element) {
      // Nivel raíz: agrupamos las rutas fijadas en un árbol virtual por carpeta.
      const fixedPaths = this.modeStore.getPathsForMode(activeMode);
      const tree = this._buildVirtualTree(fixedPaths);
      return this._nodeMapToItems(tree, this.workspaceRoot, []);
    }

    // Expandir una carpeta VIRTUAL (agrupadora): sus hijos ya están calculados.
    if (element instanceof VirtualFolderItem) {
      return this._nodeMapToItems(element.childrenNode, element.fullPath, element.segments || []);
    }

    // Expandir una carpeta FIJADA real: mostramos su contenido tal cual está en disco.
    if (fs.existsSync(element.fullPath) && fs.lstatSync(element.fullPath).isDirectory()) {
      return fs.readdirSync(element.fullPath).map((childName) => {
        const childFullPath = path.join(element.fullPath, childName);
        const isDir = fs.lstatSync(childFullPath).isDirectory();
        return new FileModeItem(
          childName,
          childFullPath,
          isDir,
          isDir
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        );
      });
    }

    return [];
  }

  /**
   * Convierte la lista plana de rutas fijadas (ej: "app/main.py",
   * "app/testfile.py", ".venv/Lib/site-packages/click/_compat.py") en un
   * árbol anidado tipo:
   * {
   *   app: { __leaf: false, children: { "main.py": {__leaf:true, relPath:"app/main.py"}, ... } },
   *   ".venv": { __leaf:false, children: { ... } }
   * }
   * Cada segmento de carpeta intermedio se vuelve un nodo virtual;
   * el último segmento de cada ruta fijada es una hoja real (__leaf true)
   * que sabemos cómo quitar del modo.
   */
  _buildVirtualTree(fixedPaths) {
    const root = new Map();
    for (const relPath of fixedPaths) {
      const segments = relPath.split(/[\\/]/).filter(Boolean);
      let currentMap = root;
      segments.forEach((segment, index) => {
        const isLastSegment = index === segments.length - 1;
        if (!currentMap.has(segment)) {
          currentMap.set(segment, {
            children: new Map(),
            isFixedLeaf: false,
            relPath: null
          });
        }
        const node = currentMap.get(segment);
        if (isLastSegment) {
          // Este segmento es exactamente lo que el usuario fijó.
          node.isFixedLeaf = true;
          node.relPath = relPath;
        }
        currentMap = node.children;
      });
    }
    return root;
  }

  /**
   * Recorre un nivel del árbol virtual y genera los TreeItem
   * correspondientes: si el nodo es la ruta exacta que se fijó, se
   * construye como archivo/carpeta real (removible); si es solo un
   * ancestro de agrupación, se construye como VirtualFolderItem.
   */
  _nodeMapToItems(nodeMap, parentFullPath, parentSegments) {
    const items = [];
    for (const [segment, node] of nodeMap) {
      const fullPath = path.join(parentFullPath, segment);
      const segments = [...parentSegments, segment];

      if (node.isFixedLeaf) {
        // Es una entrada real fijada por el usuario: usamos el comportamiento
        // ya existente (abre archivo, o si es carpeta expande contenido real).
        items.push(this._buildItemFromRelativePath(node.relPath, segment));
      } else {
        // Es una carpeta que solo existe para agrupar visualmente.
        const virtualItem = new VirtualFolderItem(segment, fullPath, node.children);
        virtualItem.segments = segments;
        items.push(virtualItem);
      }
    }
    return items;
  }

  _buildItemFromRelativePath(relPath, labelOverride) {
    const fullPath = path.join(this.workspaceRoot, relPath);
    const exists = fs.existsSync(fullPath);
    const isDir = exists && fs.lstatSync(fullPath).isDirectory();
    // Etiqueta amigable: mostramos solo el nombre final (ej: "testfile.py"),
    // ya que la ruta de carpetas ahora se ve en la jerarquía del árbol.
    const baseLabel = labelOverride || path.basename(relPath);
    const label = relPath.startsWith('node_modules') && !labelOverride
      ? `${baseLabel}  (node_modules)`
      : baseLabel;

    const item = new FileModeItem(
      label,
      fullPath,
      isDir,
      isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    // Guardamos la ruta relativa original para poder "quitar de modo" después.
    item.relativePath = relPath;
    if (!exists) {
      item.description = '(no encontrado)';
      item.iconPath = new vscode.ThemeIcon('warning');
    }
    return item;
  }
}

function activate(context) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    // Sin carpeta abierta no tiene sentido activar la extensión.
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const modeStore = new ModeStore(workspaceRoot);
  const provider = new FileModesProvider(workspaceRoot, modeStore);

  // Usamos createTreeView (en vez de registerTreeDataProvider) porque nos
  // devuelve un objeto TreeView cuyo ".title" podemos cambiar en caliente.
  // IMPORTANTE: el "name" declarado en package.json ya es "Espacios", así
  // que aquí NO repetimos la marca "D.E.N.N.I.S." (eso vive solo en el
  // ícono/tooltip de la barra de actividad) para evitar el texto duplicado.
  const treeView = vscode.window.createTreeView('fileModesView', {
    treeDataProvider: provider
  });
  context.subscriptions.push(treeView);

  function updateViewTitle() {
    const activeMode = modeStore.getActiveMode();
    // El prefijo "D.E.N.N.I.S." ya lo pone VSCode automáticamente usando el
    // "name" declarado en package.json (views > fileModesView > name),
    // así que aquí solo pasamos el nombre del espacio para no duplicarlo.
    // Resultado final visible: "D.E.N.N.I.S. : analitica".
    treeView.title = activeMode || '(sin espacio activo)';
  }
  updateViewTitle();

  // Comando: seleccionar cuál espacio está activo (QuickPick con los espacios existentes).
  context.subscriptions.push(
    vscode.commands.registerCommand('fileModes.selectMode', async () => {
      const modeNames = modeStore.getModeNames();
      if (modeNames.length === 0) {
        const created = await vscode.commands.executeCommand('fileModes.createMode');
        if (!created) return;
        provider.refresh();
        updateViewTitle();
        return;
      }
      const picked = await vscode.window.showQuickPick(modeNames, {
        placeHolder: 'Selecciona el espacio de trabajo a activar'
      });
      if (picked) {
        modeStore.setActiveMode(picked);
        provider.refresh();
        updateViewTitle();
      }
    })
  );

  // Comando: crear un espacio nuevo (pide un nombre por InputBox).
  context.subscriptions.push(
    vscode.commands.registerCommand('fileModes.createMode', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Nombre del nuevo espacio (ej: analitica, auth, pagos)',
        validateInput: (value) => (value.trim().length === 0 ? 'El nombre no puede estar vacío' : null)
      });
      if (!name) return false;
      modeStore.createMode(name.trim());
      modeStore.setActiveMode(name.trim());
      provider.refresh();
      updateViewTitle();
      return true;
    })
  );

  // Comando: agregar un archivo/carpeta a un espacio.
  // Puede dispararse de 3 formas, por eso "uri" puede venir vacío:
  //   1) Clic derecho sobre un archivo en el Explorador (uri viene con ese archivo).
  //   2) Clic derecho DENTRO del editor de código abierto (uri viene con el archivo abierto).
  //   3) Atajo de teclado (Ctrl+Alt+D / Cmd+Alt+D) estando enfocado en un editor:
  //      ahí no llega "uri", así que la tomamos del editor activo.
  context.subscriptions.push(
    vscode.commands.registerCommand('fileModes.addToMode', async (uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targetUri = activeEditor.document.uri;
        }
      }
      if (!targetUri) {
        vscode.window.showWarningMessage(
          'D.E.N.N.I.S.: no hay ningún archivo activo ni seleccionado para agregar a un espacio.'
        );
        return;
      }

      const relativePath = path.relative(workspaceRoot, targetUri.fsPath);

      let modeNames = modeStore.getModeNames();
      const CREATE_NEW = '$(add) Crear nuevo espacio...';
      const picked = await vscode.window.showQuickPick([CREATE_NEW, ...modeNames], {
        placeHolder: `¿A qué espacio quieres agregar "${relativePath}"?`
      });
      if (!picked) return;

      let targetMode = picked;
      if (picked === CREATE_NEW) {
        const name = await vscode.window.showInputBox({ prompt: 'Nombre del nuevo espacio' });
        if (!name) return;
        targetMode = name.trim();
        modeStore.createMode(targetMode);
      }

      modeStore.addPathToMode(targetMode, relativePath);
      vscode.window.showInformationMessage(`Agregado a espacio "${targetMode}": ${relativePath}`);
      provider.refresh();
      updateViewTitle();
    })
  );

  // Comando: quitar un archivo del espacio actual (clic derecho dentro del panel de D.E.N.N.I.S.).
  context.subscriptions.push(
    vscode.commands.registerCommand('fileModes.removeFromMode', async (item) => {
      const activeMode = modeStore.getActiveMode();
      if (!activeMode || !item || !item.relativePath) return;
      modeStore.removePathFromMode(activeMode, item.relativePath);
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fileModes.refresh', () => provider.refresh())
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
