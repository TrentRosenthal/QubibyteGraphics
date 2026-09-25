import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    ignores: ['vendor/**', 'dist/**', 'node_modules/**', 'coverage/**', 'out/**', 'docs/site/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', console: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', performance: 'readonly',
        HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', customElements: 'readonly',
        OffscreenCanvas: 'readonly', ImageData: 'readonly', Image: 'readonly', Path2D: 'readonly',
        Blob: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', FileReader: 'readonly', fetch: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', DOMParser: 'readonly', XMLSerializer: 'readonly',
        Worker: 'readonly', MessageChannel: 'readonly', postMessage: 'readonly', self: 'readonly',
        VideoEncoder: 'readonly', VideoFrame: 'readonly', AudioContext: 'readonly', OfflineAudioContext: 'readonly',
        ResizeObserver: 'readonly', IntersectionObserver: 'readonly', matchMedia: 'readonly',
        localStorage: 'readonly', history: 'readonly', location: 'readonly', crypto: 'readonly',
        createImageBitmap: 'readonly', ImageBitmap: 'readonly', FontFace: 'readonly', KeyboardEvent: 'readonly',
        structuredClone: 'readonly', queueMicrotask: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
        process: 'readonly', Buffer: 'readonly', globalThis: 'readonly', atob: 'readonly', btoa: 'readonly',
        CompressionStream: 'readonly', DecompressionStream: 'readonly', Response: 'readonly',
        alert: 'readonly', getComputedStyle: 'readonly', MutationEvent: 'readonly', DragEvent: 'readonly',
        PointerEvent: 'readonly', MouseEvent: 'readonly', WheelEvent: 'readonly', Node: 'readonly',
        AbortController: 'readonly', WebGL2RenderingContext: 'readonly', WebGLRenderingContext: 'readonly',
        CanvasRenderingContext2D: 'readonly', HTMLImageElement: 'readonly', HTMLVideoElement: 'readonly',
        HTMLElementTagNameMap: 'readonly', SVGElement: 'readonly', prompt: 'readonly', confirm: 'readonly',
      },
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'off',
    },
  },
  {
    files: ['cli/**/*.js', 'tools/**/*.js', 'tests/**/*.js'],
    rules: { 'no-console': 'off' },
  },
];
