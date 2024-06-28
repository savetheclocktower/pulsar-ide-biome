const { CompositeDisposable } = require('atom');
const Path = require('path');
const FS = require('fs');
const { spawn } = require('child_process');
const JSONC = require('jsonc-parser');
const {
  AutoLanguageClient
} = require('@savetheclocktower/atom-languageclient');
const console = require('./console');

const ROOT = Path.normalize(Path.join(__dirname, '..'));

const EMPTY_CODE_FORMAT_PROVIDER = Object.freeze({
  grammarScopes: [],
  priority: 100,
  formatCode: () => Promise.resolve([]),
  formatEntireFile: () => Promise.resolve([]),
  formatOnSave: () => Promise.resolve([]),
  formatAtPosition: () => Promise.resolve([])
});

const POSSIBLE_CONFIG_FILE_NAMES = ['biome.json', 'biome.jsonc'];

function showSpawnError(stderr) {
  atom.notifications.addError('Biome: Error during save', {
    detail: stderr,
    dismissable: true
  });
}

function showGenericError(error) {
  atom.notifications.addError('Biome: Unknown error during save', {
    detail: error.message,
    dismissable: true
  });
}

class SpawnError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.message = message;
    this.exitCode = exitCode;
  }
}

async function asyncSpawn(...args) {
  const child = spawn(...args);

  let stdout = '';
  for await (const chunk of child.stdout) {
    stdout += chunk;
  }
  let stderr = '';
  for await (const chunk of child.stderr) {
    stderr += chunk;
  }

  const exitCode = await new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });

  if (exitCode !== 0) {
    throw new SpawnError(stderr, exitCode);
    // showSpawnError(stderr);
    // throw new Error(`Subprocess error: exit ${exitCode}; ${stderr}`);
  }
  return [stdout, stderr];
}

class BiomeLanguageClient extends AutoLanguageClient {
  activate(...args) {
    super.activate(...args);
    let packageName = this.getPackageName();

    this.commandDisposable = atom.commands.add('atom-workspace', {
      [`${packageName}:start-language-server`]: () => {
        // This command doesn't do anything on its own. Its purpose is to
        // start the language server manually when the user wants to use it
        // for non-TypeScript files.
        //
        // It'd be rude to start the language server 100% of the time, and
        // there's no way to programmatically add to the list of
        // `activationHooks` present in `package.json`, so the compromise
        // option is to provide automatic startup for TypeScript files and
        // ask the user to invoke startup for everything else.
        console.debug('Starting language server...');
      }
    });

    // TODO: Subscribe to this config file so that we can update our settings
    // when its contents change.
    let configFilePath = this.getConfigFilePath();
    if (configFilePath) {
      let contents = FS.readFileSync(configFilePath);
      this.config = this.parseConfig(configFilePath, contents);
    } else {
      this.config = null;
    }
  }

  parseConfig(configFilePath, contents) {
    if (configFilePath.endsWith('jsonc')) {
      return JSONC.parse(contents);
    } else {
      return JSON.parse(contents);
    }
  }

  destroy(...args) {
    super.destroy(...args);
    this.commandDisposable.dispose();
    this.subscriptions.dispose();
  }

  constructor() {
    super();
    this.subscriptions = new CompositeDisposable();
    this.watchedEditors = new WeakSet();
  }

  getGrammarScopes() {
    return [
      'source.ts',
      'source.tsx',
      'source.js',
      'source.json',
      'source.css'
    ];
  }

  getLanguageName() {
    return 'Biome';
  }
  getServerName() {
    return 'Biome Language Server';
  }

  getPackageName() {
    return Path.basename(ROOT) ?? 'pulsar-ide-biome';
  }

  configFileExists() {
    let rootPaths = atom.project.getPaths();
    for (let rootPath of rootPaths) {
      for (let name of POSSIBLE_CONFIG_FILE_NAMES) {
        let possibleConfigPath = Path.join(rootPath, name);
        if (FS.existsSync(possibleConfigPath)) {
          return possibleConfigPath;
        }
      }
    }
    return false;
  }

  shouldStartForEditor(editor) {
    if (!this.configFileExists()) return false;
    let result = super.shouldStartForEditor(editor);
    if (result && !this.watchedEditors.has(editor)) {
      this.watchedEditors.add(editor);
      this.subscriptions.add(
        editor.onDidSave(async () => {
          return await this.formatDocumentOnSave(editor);
        })
      );
    }
    return result;
  }

  async formatDocumentOnSave(editor) {
    let shouldFormat = this.getScopedSettingForEditor(
      `${this.getPackageName()}.formatOnSave`,
      editor
    );
    if (!shouldFormat) return;

    console.log('Formatting on save…');
    let bin = this.getPathToBiome();
    let configFilePath = this.getConfigFilePath();
    let bufferPath = editor.getPath();
    if (!bin || !configFilePath || !bufferPath) return;

    try {
      let [_stdout, _stderr] = await asyncSpawn(bin, [
        'format',
        '--write',
        '--config-path',
        configFilePath,
        bufferPath
      ]);
    } catch (err) {
      if (err instanceof SpawnError) {
        showSpawnError(err.message);
      } else {
        showGenericError(err);
      }
    }
  }

  getPathToBiome() {
    return Path.join(ROOT, 'node_modules', '.bin', 'biome');
  }

  getConfigFilePath() {
    let filePath = this.configFileExists();
    return filePath || null;
  }

  startServerProcess() {
    let bin = this.getPathToBiome();
    console.log('Starting bin at path:', bin);
    // TODO: Right now, Biome seems to be cool with Node 14; if they raise
    // their requirements before Pulsar can upgrade Electron, we'll have to go
    // with the bring-your-own-Node model.
    return super.spawnChildNode([bin, 'lsp-proxy']);
  }

  _getSettingForScope(scope, key) {
    return atom.config.get(key, { scope: [scope] });
  }

  postInitialization(server) {
    this._server = server;
  }

  editorIsJavaScript(editor) {
    if (!editor) return false;
    let grammar = editor.getGrammar();
    return /\.jsx?/.test(grammar.scopeName);
  }

  // Look up scope-specific settings for a particular editor. If `editor` is
  // `undefined`, it'll return general settings for the same key.
  getScopedSettingForEditor(key, editor) {
    let schema = atom.config.getSchema(key);
    if (!schema) throw new Error(`Unknown config key: ${schema}`);

    let base = atom.config.get(key);
    if (!editor) return base;

    let grammar = editor.getGrammar();
    let scoped = atom.config.get(key, { scope: [grammar.scopeName] });

    if (schema?.type === 'object') {
      return { ...base, ...scoped };
    } else {
      return scoped ?? base;
    }
  }

  // LINTER
  // ======

  getLinterSettings(editor) {
    return this.getScopedSettingForEditor(
      `${this.getPackageName()}.linter`,
      editor
    );
  }

  shouldIgnoreMessage(_diagnostic, _editor, _range) {
    // TODO: Biome's linting is _very_ aggressive. We might want to offer more
    // ways to customize it.
    return false;
  }

  // Optionally alter a linting message before it is shown.
  transformMessage(message, diagnostic, editor) {
    let settings = this.getLinterSettings(editor);
    let { code } = diagnostic;
    if (code && settings.includeMessageCodeInMessageBody) {
      message.excerpt = `${message.excerpt} (${diagnostic.code})`;
    }
  }

  // CODE FORMAT
  // ===========

  shouldProvideCodeFormat(type) {
    if (type === 'onSave') {
      // We handle format-on-save ourselves.
      return false;
    }

    // Only try to format code if there's a `biome.json` config file.
    if (!this.configFileExists()) return false;

    if (!this.config) return;

    // The explicit `formatDocumentOnSave` method that we implement doesn't need
    // to do this because Biome will decline to attempt a format action…
    if (!this.config?.formatter?.enabled) return false;

    // …but other kinds of code formatting are triggered explicitly via
    // command, hence are always available.
    return true;
  }

  provideCodeFormat() {
    if (!this.shouldProvideCodeFormat('range')) {
      return EMPTY_CODE_FORMAT_PROVIDER;
    }
    return super.provideCodeFormat();
  }

  provideRangeCodeFormat() {
    if (!this.shouldProvideCodeFormat('range')) {
      return EMPTY_CODE_FORMAT_PROVIDER;
    }
    return super.provideRangeCodeFormat();
  }

  provideFileCodeFormat() {
    if (!this.shouldProvideCodeFormat('file')) {
      return EMPTY_CODE_FORMAT_PROVIDER;
    }
    return super.provideFileCodeFormat();
  }

  provideOnSaveCodeFormat() {
    if (!this.shouldProvideCodeFormat('onSave')) {
      return EMPTY_CODE_FORMAT_PROVIDER;
    }
    return super.provideOnSaveCodeFormat();
  }

  provideOnTypeCodeFormat() {
    if (!this.shouldProvideCodeFormat('onType')) {
      return EMPTY_CODE_FORMAT_PROVIDER;
    }
    return super.provideOnTypeCodeFormat();
  }

  // INTENTIONS
  // ==========

  // This is annoying because it should be almost entirely a package-specific
  // concern. But `atom-languageclient` must be aware of this because there's
  // no concept of a “code” or “message type” in the `linter` service contract.
  // So we can't pull this off just by inspecting the linter messages; we have
  // to look at the original `Diagnostic` objects from the language server.
  getIntentionsForLinterMessage({ code, callback }, editor) {
    let packageName = this.getPackageName();
    const IGNORED_CODES_NAME = `${packageName}.linter.ignoredCodes`;
    const IGNORED_UNTIL_SAVE_NAME = `${packageName}.linter.ignoredCodesWhenBufferIsModified`;
    let intentions = [];
    let settings = this.getLinterSettings(editor);
    let { ignoredCodes = [], ignoredCodesWhenBufferIsModified = [] } = settings;

    // What are the existing ignore settings for this kind of message?
    let isAlwaysIgnored = ignoredCodes.includes(code);
    let isIgnoredUntilSave = ignoredCodesWhenBufferIsModified.includes(code);

    if (!isAlwaysIgnored) {
      intentions.push({
        priority: 1,
        icon: 'mute',
        title: `Always ignore this type of message (${code})`,
        selected: () => {
          let ignoredCodes = atom.config.get(IGNORED_CODES_NAME);
          let ignoredUntilSave = atom.config.get(IGNORED_UNTIL_SAVE_NAME);
          if (ignoredUntilSave.includes(code)) {
            let index = ignoredUntilSave.indexOf(code);
            ignoredUntilSave.splice(index, 1);
          }
          atom.config.set(IGNORED_CODES_NAME, [...ignoredCodes, code]);
          callback();
        }
      });
    }

    if (!isIgnoredUntilSave) {
      intentions.push({
        priority: 1,
        icon: 'mute',
        title: `Always ignore this type of message until save (${code})`,
        selected: () => {
          let ignoredUntilSave = atom.config.get(IGNORED_UNTIL_SAVE_NAME);
          let ignoredCodes = atom.config.get(IGNORED_CODES_NAME);
          if (ignoredCodes.includes(code)) {
            let index = ignoredCodes.indexOf(code);
            ignoredCodes.splice(index, 1);
          }
          atom.config.set(IGNORED_UNTIL_SAVE_NAME, [...ignoredUntilSave, code]);
          callback();
        }
      });
    }

    return intentions;
  }
}

module.exports = new BiomeLanguageClient();
