import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey, { cdn, util } from 'vite-plugin-monkey';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Migaku Custom Stats',
        icon: 'https://study.migaku.com/favicon.ico',
        namespace: 'http://tampermonkey.net/',
        match: ['https://study.migaku.com/*'],
        version: '0.2.5',
        description: 'More stats for Migaku Memory.',
        author: 'sguadalupe',
        license: 'GPL-3.0',
        'run-at': 'document-idle',
        supportURL: 'https://github.com/SebastianGuadalupe/MigakuStats/issues',
        homepageURL: 'https://github.com/SebastianGuadalupe/MigakuStats',
      },
      clientAlias: 'monkey',
      build: {
        externalGlobals: [
          [
            'vue',
            cdn
              .jsdelivr('Vue', 'dist/vue.global.prod.js')
              .concat(util.dataUrl(';window.Vue=Vue;')),
          ],
          ['pinia', cdn.jsdelivr('Pinia', 'dist/pinia.iife.prod.js')],
          [
            'chart.js',
            cdn.jsdelivr('Chart', 'dist/chart.umd.min.js'),
          ],
          ['sql.js', cdn.jsdelivr('initSqlJs', 'dist/sql-wasm.min.js')],
          ['pako', cdn.jsdelivr('pako', 'dist/pako.min.js')],
        ],
        externalResource: {},
      },
    }),
  ],
});
