import UssdSimulator from '@/components/ussd/UssdSimulator'
import { Heading } from '@/shared/Heading'
import { notFound } from 'next/navigation'

/** Development only. The real entry point is Hubtel's shortcode posting to /api/ussd/hubtel. */
export default function UssdSimulatorPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="container space-y-6 py-16 lg:py-24">
      <div>
        <Heading>USSD simulator</Heading>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Walks the same menu a caller gets on the shortcode. A confirmed vote creates a pending payment; approve it
          from the vote page&apos;s dev panel or let reconciliation handle it.
        </p>
      </div>
      <UssdSimulator />
    </main>
  )
}
