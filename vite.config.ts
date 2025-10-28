import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey, { cdn } from 'vite-plugin-monkey';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        icon: 'https://study.migaku.com/favicon.ico',
        namespace: 'npm/vite-plugin-monkey',
        match: ['https://study.migaku.com/*'],
      },
      build: {
        externalGlobals: {
          vue: cdn.jsdelivr('Vue', 'dist/vue.global.prod.js'),
          pinia: cdn.unpkg('Pinia', 'dist/pinia.iife.min.js'),
          'chart.js': cdn.jsdelivr('Chart', 'dist/chart.umd.min.js'),
          'sql.js': cdn.jsdelivr('initSqlJs', 'sql-wasm.js'),
          pako: cdn.jsdelivr('pako', 'dist/pako.min.js'),
        },
      },
    }),
  ],
});
