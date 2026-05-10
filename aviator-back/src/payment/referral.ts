import { UserModel } from "../db/models/User";
import { ReferralRewardModel } from "../db/models/ReferralReward";
import { engine } from "../game/engine";
import { pushToUser, pushUserMyInfo } from "../sockets";
import { getSetting } from "../settings";

/**
 * Credit the referral reward to the referee's referrer (if any).
 *
 * IDEMPOTENT — guarded by the unique (referrer + sourceType + sourceId)
 * index on ReferralReward. Safe to call multiple times for the same
 * recharge event (webhook retries, watcher reclaims).
 *
 *   • Looked up: referee user → its `referrer` field.
 *   • If no referrer set, no-op.
 *   • If referrer was already paid for this exact source event, no-op.
 *   • Otherwise: credit referralRewardInr (live setting) to referrer's
 *     balance + bump their referralEarned counter + write audit row.
 *
 * The reward is FIXED per event (e.g. ₹100) — NOT a percentage of the
 * recharge. This matches the spec: "充值或者提现都触发奖励，奖励100卢比".
 */
export const triggerReferralReward = async (
  refereeUserName: string,
  source: { type: "recharge" | "crypto" | "payout"; id: string; amountInr: number },
): Promise<void> => {
  const reward = Number(getSetting("referralRewardInr") || 0);
  if (reward <= 0) return;

  const referee = await UserModel.findOne({ userName: refereeUserName }).lean();
  if (!referee || !referee.referrer) return;
  const referrerName = referee.referrer;
  if (referrerName === refereeUserName) return; // self-ref guard (defence in depth)

  // Reserve the audit slot first — duplicate key error means already paid.
  try {
    await ReferralRewardModel.create({
      referrer: referrerName,
      referee: refereeUserName,
      sourceType: source.type,
      sourceId: source.id,
      amountInr: reward,
      refereeAmountInr: source.amountInr,
    });
  } catch (e: any) {
    if (e?.code === 11000) {
      // Already credited for this event.
      return;
    }
    console.warn(`[referral] audit insert failed for ${refereeUserName}:`, e?.message || e);
    return;
  }

  // Credit balance + bump cumulative.
  // Use creditRecharge so the reward is locked behind the same wager
  // multiplier as a normal recharge (1× by default). Anti-abuse: prevents
  // self-referral cycles from netting out instantly — referrer must wager
  // through the reward before withdrawing it. Doesn't affect honest users
  // who play normally.
  const newBalance = await engine.creditRecharge(referrerName, reward);
  await UserModel.updateOne(
    { userName: referrerName },
    { $inc: { referralEarned: reward } },
  );

  pushToUser(referrerName, "referralReward", {
    from: refereeUserName,
    amount: reward,
    balance: newBalance,
    sourceType: source.type,
  });
  pushUserMyInfo(referrerName);

  console.log(
    `[referral] +₹${reward} to ${referrerName} from ${refereeUserName} (${source.type} ${source.id.slice(0, 10)}…)`,
  );
};
