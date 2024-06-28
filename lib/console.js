const TAG = '[pulsar-ide-biome]';

let isEnabled = false;

atom.config.observe('pulsar-ide-biome.advanced.enableDebugLogging', (value) => {
  isEnabled = value;
});

function log(...args) {
  if (!isEnabled) return;
  return console.log(TAG, ...args);
}

function warn(...args) {
  if (!isEnabled) return;
  return console.warn(TAG, ...args);
}

function debug(...args) {
  if (!isEnabled) return;
  return console.debug(TAG, ...args);
}

function error(...args) {
  if (!isEnabled) return;
  return console.error(TAG, ...args);
}

module.exports = {
  log,
  warn,
  debug,
  error
};
