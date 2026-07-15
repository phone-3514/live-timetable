import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this as a project site at /live-timetable/, but
  // local dev should stay at the site root so `npm run dev` URLs don't change.
  base: command === 'build' ? '/live-timetable/' : '/',
  plugins: [react(), tailwindcss()],
}))
