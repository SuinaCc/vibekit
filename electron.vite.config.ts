import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'path';

const sharedAlias = {
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
        external: ['better-sqlite3'],
      },
      minify: 'esbuild',
    },
    resolve: {
      alias: sharedAlias,
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
      minify: 'esbuild',
    },
    resolve: {
      alias: sharedAlias,
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [solid()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          recorder: resolve(__dirname, 'src/renderer/recorder.html'),
          phone: resolve(__dirname, 'src/renderer/phone.html'),
        },
      },
      minify: 'esbuild',
      target: 'chrome120',
    },
    resolve: {
      alias: {
        ...sharedAlias,
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
  },
});
