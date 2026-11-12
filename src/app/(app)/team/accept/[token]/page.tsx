import AcceptInvite from '@/components/team/AcceptInvite'
import { getSessionUserId } from '@/lib/auth-session'
import { getOrganization, getUserDoc } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { checkInviteToken } from '@/lib/invite-token'
import { findInviteByToken } from '@/lib/team-server'
import Logo from '@/shared/Logo'
import Link from 'next/link'

type Props = { params: Promise<{ token: string }> }

/**
 * The invitee lands here from the email or a shared link. Without a session
 * they are sent to sign in or sign up and brought back; with one, they see
 * who invited them to what and join with one click, as long as their
 * account's email is the invited one.
 */
export default async function AcceptPage({ params }: Props) {
  const { token } = await params
  const { t } = await getTranslations()
  const invite = await findInviteByToken(token)
  const check = invite
    ? checkInviteToken(token, {
        inviteTokenHash: invite.tokenHash,
        inviteExpiresAt: invite.expiresAt,
        claimedAt: invite.acceptedAt,
      })
    : 'invalid'
  const valid = check === 'ok' && invite?.status === 'pending'
  const organization = invite ? await getOrganization(invite.organizationId) : null
  const userId = await getSessionUserId()
  const user = userId ? await getUserDoc(userId) : null
  const back = `/team/accept/${token}`

  return (
    <div className="container pb-16">
      <div className="my-16 flex justify-center">
        <Logo className="w-36" />
      </div>
      <div className="mx-auto max-w-md space-y-6 text-center">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:team.accept.title')}</h1>
        {!valid ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t(
              `errors:team.${check === 'used' || invite?.status === 'accepted' ? 'tokenUsed' : check === 'expired' ? 'tokenExpired' : 'tokenInvalid'}`
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {t('web:team.accept.body', {
                org: organization?.name ?? '',
                role: t(`web:dashboard.role.${invite!.role}`),
                email: invite!.email,
              })}
            </p>
            {!userId ? (
              <div className="space-y-2">
                <Link
                  href={`/login?redirect=${encodeURIComponent(back)}`}
                  className="block rounded-xl btn-brand px-4 py-3 text-sm font-medium"
                >
                  {t('web:team.accept.signIn')}
                </Link>
                <Link href={`/signup?redirect=${encodeURIComponent(back)}`} className="block text-sm underline">
                  {t('web:team.accept.signUp')}
                </Link>
              </div>
            ) : user && user.email.toLowerCase() !== invite!.email.toLowerCase() ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {t('web:team.accept.wrongAccount', { current: user.email, invited: invite!.email })}
              </div>
            ) : (
              <AcceptInvite token={token} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
