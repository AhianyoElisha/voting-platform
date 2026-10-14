import Footer2 from '@/components/Footer2'
import Header from '@/components/Header/Header'
import MobileHeader from '@/components/Header/MobileHeader'
import Aside from '@/components/aside'
import AsideSidebarNavigation from '@/components/aside-sidebar-navigation'
import React, { ReactNode } from 'react'

interface Props {
  children: ReactNode
  header?: ReactNode
}

/** Page chrome shared by the public site and the signed-in areas: header, footer, mobile sidebar. */
const ApplicationLayout: React.FC<Props> = ({ children, header }) => {
  return (
    <Aside.Provider>
      {/* Desktop header, hidden on mobile */}
      <div className="relative z-20 hidden lg:block">{header ? header : <Header />}</div>
      <MobileHeader />
      {children}
      <Footer2 />
      <AsideSidebarNavigation />
    </Aside.Provider>
  )
}

export { ApplicationLayout }
