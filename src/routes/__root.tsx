import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'


import '../styles.css'
import 'leaflet/dist/leaflet.css'

const siteName = 'Rêber — Rêberiya rê bi Kurmancî'
const siteDescription = 'Rêya xwe bibîne. Rêberiya rê bi Kurmancî, bi nexşeya OpenStreetMap û GPS.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: siteName,
      },
      {
        name: 'description',
        content: siteDescription,
      },
      {
        name: 'theme-color',
        content: '#ffffff',
      },
      {
        property: 'og:title',
        content: siteName,
      },
      {
        property: 'og:description',
        content: siteDescription,
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    ],
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/reber-icon.svg' }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ku-Latn">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
