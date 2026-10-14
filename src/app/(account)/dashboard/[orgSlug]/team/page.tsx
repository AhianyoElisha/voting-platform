import TeamPanel from '@/components/team/TeamPanel'
import { getTranslations } from '@/lib/i18n-server'
import { resolveWorkspace } from '@/lib/page-tenant'
import { listInvites, listMembers } from '@/lib/team-server'
import { canManage } from '@/lib/tenant'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'

type Props = { params: Promise<{ orgSlug: string }> }

export default async function TeamPage({ params }: Props) {
  const { orgSlug } = await params
  const { ctx, organization } = await resolveWorkspace(orgSlug, `/dashboard/${orgSlug}/team`)
  const { t } = await getTranslations()
  const [members, invites] = await Promise.all([listMembers(ctx), listInvites(ctx)])
  return (
    <main className="container space-y-8 py-16 lg:py-24">
      <div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href="/dashboard" className="underline">
            {t('web:dashboard.title')}
          </Link>{' '}
          / {organization.name}
        </p>
        <Heading>{t('web:team.title')}</Heading>
      </div>
      <TeamPanel
        orgId={organization.$id}
        me={ctx.userId}
        canManage={canManage(ctx.role)}
        members={members.map(({ membership, user }) => ({
          id: membership.$id,
          userId: membership.userId,
          role: membership.role,
          name: user?.fullName ?? null,
          email: user?.email ?? null,
        }))}
        invites={invites.map((i) => ({ id: i.$id, email: i.email, role: i.role, status: i.status }))}
      />
    </main>
  )
}
