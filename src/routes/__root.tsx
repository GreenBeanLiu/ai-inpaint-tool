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
        title: 'AI Inpaint Tool',
      },
      {
        name: 'description',
        content: 'Initial TanStack Start MVP scaffold for AI image inpainting jobs.',
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
            <div>
              <div className="app-brand">AI Inpaint Tool</div>
              <div className="muted">TanStack Start MVP scaffold</div>
            </div>
            <nav className="actions">
              <Link to="/" activeProps={{ 'aria-current': 'page' }}>
                New Job
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
      <body>{children}<Scripts /></body>
    </html>
  )
}
