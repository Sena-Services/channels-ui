import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const FRAPPE_PORT = process.env.VITE_FRAPPE_PORT || '8001'
const FRAPPE_HOST = process.env.VITE_FRAPPE_HOST || 'dev.localhost'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:${FRAPPE_PORT}`,
        changeOrigin: true,
        headers: { Host: FRAPPE_HOST },
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes, req) => {
            const setCookie = proxyRes.headers['set-cookie']
            if (setCookie) {
              // Strip SameSite/Secure so cookies persist in iframe context
              proxyRes.headers['set-cookie'] = setCookie.map((c) =>
                c.replace(/;\s*SameSite=\w+/gi, '').replace(/;\s*Secure/gi, '')
              )
              // For login: expose sid as a readable response header so JS can
              // store it manually — bypasses HttpOnly + third-party cookie blocking
              if (req.url && req.url.includes('/method/login')) {
                const sidCookie = setCookie.find((c) => c.startsWith('sid='))
                if (sidCookie) {
                  const sid = sidCookie.split(';')[0].replace('sid=', '')
                  proxyRes.headers['x-frappe-sid'] = sid
                  // Also expose this header to JS
                  const expose = proxyRes.headers['access-control-expose-headers']
                  proxyRes.headers['access-control-expose-headers'] = expose
                    ? `${expose}, x-frappe-sid`
                    : 'x-frappe-sid'
                }
              }
            }
          })
        },
      },
    },
  },
})
