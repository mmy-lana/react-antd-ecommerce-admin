/// <reference types="vite/client" />

/**
 * Ambient declarations for non-code assets imported for their side effects.
 * `tsc` alone cannot resolve these; Vite handles them at bundle time.
 */
declare module '*.css' {
  const stylesheet: string;
  export default stylesheet;
}
