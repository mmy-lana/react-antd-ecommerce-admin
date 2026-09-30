/**
 * Ambient declaration for the polyfill's auto-install entry point.
 *
 * `fake-indexeddb` ships typings but omits the `./auto` subpath from its
 * package `exports` map, so `moduleResolution: bundler` cannot resolve it.
 */
declare module 'fake-indexeddb/auto' {
  /** Installs the IndexedDB implementation onto `globalThis`. */
  const autoInstall: undefined;
  export default autoInstall;
}
