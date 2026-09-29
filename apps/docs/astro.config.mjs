import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://beeeku.github.io',
  base: '/workkit',
  integrations: [
    starlight({
      title: 'workkit',
      description: 'Composable utilities for Cloudflare Workers. Think TanStack for Workers.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/beeeku/workkit' },
      ],
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Architecture', slug: 'architecture' },
          ],
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API Reference', slug: 'api-reference' },
            { label: 'Migration', slug: 'migration' },
            { label: 'Contributing', slug: 'contributing' },
          ],
        },
      ],
      customCss: ['./src/styles/global.css'],
    }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
