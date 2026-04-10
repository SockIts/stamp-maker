import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
})
