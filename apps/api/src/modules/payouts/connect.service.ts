import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { mapAccountStatus, type StripeAccountLike } from './payouts.engine';
import {
  PAYOUTS_REPOSITORY,
  type IPayoutsRepository,
  type PayoutProfile,
} from './payouts.repository';
import { PAYOUTS_STRIPE, type IPayoutsStripe } from './payouts.stripe';

/**
 * Stripe reports "this connected account is not on your platform" with a
 * different message per endpoint, so match several. Observed on live:
 *   /v1/accounts/{id}    -> "No such account: 'acct_...'"
 *   /v1/account_links    -> "You requested an account link for an account that
 *                            is not connected to your platform or does not exist."
 * The code field is unreliable here (account_links omits `resource_missing`),
 * and the narrow port hides the SDK error type, so this matches on both.
 */
function isMissingAccountError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'resource_missing' || e.code === 'account_invalid') {
    return true;
  }
  const message = e.message ?? '';
  return (
    /No such account/i.test(message) ||
    /not connected to your platform/i.test(message)
  );
}

/**
 * Stripe Connect onboarding for consultants (PAY-1, PAY-2). One Express account
 * per consultant, created lazily on first onboarding. KYC documents live in
 * Stripe; we persist only status, and only from the webhook (never the client).
 * See VISAAIDocs/features/consultant-marketplace/STRIPE-CONNECT.md §1/§2.
 */
@Injectable()
export class ConnectService {
  private readonly log = new Logger(ConnectService.name);

  constructor(
    @Inject(PAYOUTS_REPOSITORY) private readonly repo: IPayoutsRepository,
    @Inject(PAYOUTS_STRIPE) private readonly stripe: IPayoutsStripe,
    private readonly config: ConfigService<Env>,
  ) {}

  /**
   * Start (or resume) payout onboarding for the calling user's consultant
   * profile. Returns a Stripe-hosted Account Link. The profile lookup is the
   * authorization gate — a non-consultant has no profile and is rejected.
   */
  async onboardingLink(
    userId: string,
  ): Promise<{ url: string; account_id: string }> {
    const profile = await this.repo.getProfileByUserId(userId);
    if (!profile) {
      throw new ForbiddenException('No consultant profile for this account');
    }

    const webUrl = this.config.get('WEB_URL', { infer: true }) ?? '';
    const refreshUrl =
      this.config.get('STRIPE_CONNECT_REFRESH_URL', { infer: true }) ||
      `${webUrl}/consultant/payouts?refresh=1`;
    const returnUrl =
      this.config.get('STRIPE_CONNECT_RETURN_URL', { infer: true }) ||
      `${webUrl}/consultant/payouts?onboarded=1`;

    const { result, accountId } = await this.withConnectAccount(
      profile,
      (account) =>
        this.stripe.createAccountLink({ account, refreshUrl, returnUrl }),
    );
    return { url: result.url, account_id: accountId };
  }

  /**
   * Run a Stripe call against the consultant's Connect account, healing a stale
   * stored id. A connected-account id is only valid on the platform account and
   * mode that minted it, so after a Stripe account or mode cutover every stored
   * id is dead and Stripe answers `No such account`. Retrying once with a fresh
   * account mirrors `withCustomer()` in billing — chosen over verifying up front
   * so the happy path keeps its single round trip.
   */
  private async withConnectAccount<T>(
    profile: PayoutProfile,
    run: (accountId: string) => Promise<T>,
  ): Promise<{ result: T; accountId: string }> {
    const accountId = await this.ensureAccount(profile);
    try {
      return { result: await run(accountId), accountId };
    } catch (err) {
      if (!isMissingAccountError(err)) throw err;
      this.log.warn(
        `Connect account ${accountId} missing on this platform/mode for consultant ${profile.id}; minting a replacement`,
      );
      const fresh = await this.ensureAccount(profile, true);
      return { result: await run(fresh), accountId: fresh };
    }
  }

  /** Create the Express account on first use; return the stored/created id. */
  private async ensureAccount(
    profile: PayoutProfile,
    forceNew = false,
  ): Promise<string> {
    if (!forceNew && profile.stripe_connect_account_id) {
      return profile.stripe_connect_account_id;
    }
    const { id } = await this.stripe.createExpressAccount({
      country: profile.country ?? 'US',
      email: profile.email,
      metadata: { consultant_id: profile.id },
    });
    // CONN-001: the DB row is the claim.
    //
    // The check above ("do we already have an id on file?") reads a profile
    // loaded by the caller, and the write that follows was unconditional. Two
    // concurrent onboarding requests — a double-clicked button, or a client
    // retrying a timed-out request — both saw no account, both created a REAL
    // Stripe Connect account, and the later write silently overwrote the
    // earlier: two live accounts for one consultant, one of them orphaned with
    // nothing in the database referencing it. Worse, the retry did not
    // converge: if the write failed after the Stripe call succeeded, the id
    // stayed null and the next attempt created yet another account.
    //
    // Making the write conditional on the column still being null means only
    // one caller can win. The loser adopts the winner's account rather than
    // keeping its own, so the profile and Stripe agree.
    const claimed = await this.repo.setConnectAccountId(profile.id, id, {
      onlyIfUnset: !forceNew,
    });
    if (!claimed) {
      const current = await this.repo.getProfileById(profile.id);
      const winner = current?.stripe_connect_account_id;
      if (winner) {
        this.log.warn(
          `lost the Connect-account race for consultant ${profile.id}: ` +
            `keeping ${winner}, discarding ${id}`,
        );
        return winner;
      }
      // Never return the account this request created after failing to persist
      // it. Doing so would mint an onboarding link for an orphaned Stripe
      // account, leaving the consultant unable to resume onboarding through
      // VisaAI. The conditional update can fail only because another request
      // won or the profile changed concurrently; neither outcome is safe to
      // guess about when the follow-up read finds no winner.
      this.log.error(
        `lost the Connect-account claim for consultant ${profile.id} and could not read a winner`,
      );
      throw new ServiceUnavailableException(
        'Payout onboarding is being initialized. Please retry shortly.',
      );
    }
    this.log.log(`created Connect account ${id} for consultant ${profile.id}`);
    return id;
  }

  /**
   * PAY-2: sync kyc_status + payouts_enabled from a Stripe `account.updated`
   * event object. Idempotent (a plain UPDATE keyed on the account id). Called by
   * the billing webhook after signature verification.
   */
  async syncAccountStatus(account: StripeAccountLike): Promise<void> {
    if (!account?.id) return;
    const patch = mapAccountStatus(account);
    const matched = await this.repo.syncKycByAccountId(account.id, patch);
    if (!matched) {
      this.log.warn(
        `account.updated for unknown Connect account ${account.id}`,
      );
      return;
    }
    this.log.log(
      `synced Connect ${account.id}: kyc=${patch.kyc_status} payouts_enabled=${patch.payouts_enabled}`,
    );
  }
}
