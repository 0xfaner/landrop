import { defineConfig, normalizePath } from 'vite'

export default defineConfig(() => {
  const upstream = new URL(process.env.LANDROP_API_URL ?? 'http://127.0.0.1:8765')
  return {
    server: {
      proxy: {
        '/api/v1': {
          target: upstream.origin,
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest, request) => {
              if (request.headers.origin === `http://${request.headers.host}`) {
                proxyRequest.setHeader('Origin', upstream.origin)
              }
            })
          },
        },
      },
    },
    build: {
      rolldownOptions: {
        onLog(level, log, defaultHandler) {
          // Primer's React Server Components markers are unnecessary in this browser app.
          const moduleId = normalizePath(log.id ?? '')
          if (level === 'warn' && log.code === 'MODULE_LEVEL_DIRECTIVE' &&
            log.message.includes('"use client"') &&
            /(?:^|\/)node_modules\/@primer\/react\/dist\/(?:next\/)?index\.js$/.test(moduleId)) return

          defaultHandler(level, log)
        },
      },
    },
  }
})
