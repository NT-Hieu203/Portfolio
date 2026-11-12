import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './' giúp site chạy được ở cả tenban.github.io lẫn tenban.github.io/ten-repo
export default defineConfig({
  base: './',
  plugins: [vue()],
})
