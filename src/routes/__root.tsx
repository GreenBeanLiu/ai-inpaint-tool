import type { ReactNode } from 'react'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import '@/app.css'

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
        title: 'AI Inpaint Studio',
      },
      {
        name: 'description',
        content: 'Local AI image inpainting workspace with masked editing job intake and runtime visibility.',
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <div className="app-shell">
        <div className="app-frame">
          <header className="app-header">
            <div className="app-brand-row">
              <div aria-hidden="true" className="app-brand-mark" />
              <div>
                <div className="app-brand">AI Inpaint Studio</div>
                <div className="muted">Mask-based image editing workspace</div>
              </div>
            </div>
            <nav className="actions app-nav">
              <Link className="nav-link" to="/" activeProps={{ 'aria-current': 'page' }}>
                New Edit
              </Link>
            </nav>
          </header>
          <main className="app-main">
            <Outlet />
          </main>
        </div>
      </div>
      <TanStackRouterDevtools position="bottom-right" />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
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
