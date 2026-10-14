import type { TFunction } from 'i18next'

export interface TNavigationItem {
  id: string
  name: string
  href?: string
  type?: 'dropdown' | 'mega-menu' | 'none'
  isNew?: boolean
  children?: TNavigationItem[]
}

/**
 * Main navigation. Built from `t` so labels follow the active locale; the
 * header and the mobile sidebar both render this list.
 */
export function getNavigation(t: TFunction): TNavigationItem[] {
  return [
    { id: 'home', href: '/', name: t('web:nav.home.label') },
    { id: 'events', href: '/events', name: t('web:nav.events.label') },
    { id: 'organizers', href: '/signup', name: t('web:nav.forOrganizers.label') },
    { id: 'nominees', href: '/portal', name: t('web:nav.nomineePortal.label') },
  ]
}
