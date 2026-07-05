import { defineConfig } from 'vite'
import type { ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'https://testnet.acme.pics/api'
const API_PROXY_ORIGIN = process.env.VITE_API_PROXY_ORIGIN || new URL(API_PROXY_TARGET).origin
const ADMIN_PROXY_TARGET = process.env.VITE_ADMIN_PROXY_TARGET || API_PROXY_ORIGIN
const API_PROXY_REWRITE_PREFIX = API_PROXY_TARGET.endsWith('/api') ? '' : '/v2'
const COMPOSE_PROXY_REWRITE_PREFIX = API_PROXY_TARGET.endsWith('/api') ? '/api' : API_PROXY_REWRITE_PREFIX

const configureLongRequestProxy: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('proxyReq', (proxyReq, req) => {
    const contentLength = req.headers['content-length']
    if (contentLength) {
      const sizeMB = (parseInt(contentLength, 10) / (1024 * 1024)).toFixed(2)
      console.log(`[Proxy] ${req.method} ${req.url} (${sizeMB} MB)`)
    } else {
      console.log(`[Proxy] ${req.method} ${req.url}`)
    }
    proxyReq.setTimeout(0)
  })
  proxy.on('error', (err, req) => {
    console.error(`[Proxy Error] ${req.method} ${req.url}:`, err.message)
  })
  proxy.on('proxyRes', (proxyRes, req) => {
    console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`)
  })
}

// https://vite.dev/config/
export default defineConfig({
  base: '/stamp-maker/',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
    {
      name: 'image-proxy',
      configureServer(server) {
        server.middlewares.use('/image-proxy', async (req, res) => {
          try {
            const reqUrl = new URL(req.url ?? '', 'http://localhost')
            const target = reqUrl.searchParams.get('url')
            if (!target) {
              res.statusCode = 400
              res.end('Missing url')
              return
            }

            const response = await fetch(target)
            if (!response.ok) {
              res.statusCode = response.status
              res.end(`Upstream error: ${response.status}`)
              return
            }

            const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
            const buffer = Buffer.from(await response.arrayBuffer())
            res.statusCode = 200
            res.setHeader('Content-Type', contentType)
            res.setHeader('Cache-Control', 'no-store')
            res.end(buffer)
          } catch {
            res.statusCode = 500
            res.end('Proxy failed')
          }
        })
      },
    },
  ],
  server: {
    proxy: {
      '/api/compose': {
        target: API_PROXY_ORIGIN,
        changeOrigin: true,
        rewrite: (proxyPath) => proxyPath.replace(/^\/api/, COMPOSE_PROXY_REWRITE_PREFIX),
        configure: configureLongRequestProxy,
      },
      '/admin': {
        target: ADMIN_PROXY_TARGET,
        changeOrigin: true,
        configure: configureLongRequestProxy,
      },
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        rewrite: (proxyPath) => proxyPath.replace(/^\/api/, API_PROXY_REWRITE_PREFIX),
        configure: configureLongRequestProxy,
      },
    },
  },
})
