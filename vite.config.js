import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Tailwind CSS は公式 Vite プラグインで組み込む
export default defineConfig({
  plugins: [tailwindcss()],
});
