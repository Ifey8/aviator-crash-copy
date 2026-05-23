import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { UserModel } from "../db/models/User";
import { ReferralRewardModel } from "../db/models/ReferralReward";
import { getSetting } from "../settings";

export const affiliateRouter = Router();
affiliateRouter.use(requireAuth);

/**
 * GET /api/affiliate/stats
 *
 * Returns a summary for the authenticated agent:
 *   totalReferrals     — number of users who signed up using my referral link
 *   totalEarned        — cumulative INR credited to me from referral rewards
 *   totalRewardEvents  — total number of reward events (one per referred user's recharge/payout)
 *   totalRefereeDeposited — sum of all referred users' deposit amounts
 *   recentRewards      — last 10 reward events
 *   rewardPerEvent     — current fixed reward per event (admin setting, INR)
 */
affiliateRouter.get("/stats", async (req, res) => {
  const me = req.authUserName!;

  const [totalReferrals, myUser, rewardAgg, recentRewards] = await Promise.all([
    UserModel.countDocuments({ referrer: me }),
    UserModel.findOne({ userName: me }).select("referralEarned").lean(),
    ReferralRewardModel.aggregate([
      { $match: { referrer: me } },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: "$amountInr" },
          totalRefereeDeposited: { $sum: "$refereeAmountInr" },
          count: { $sum: 1 },
        },
      },
    ]),
    ReferralRewardModel.find({ referrer: me })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  const agg = rewardAgg[0] ?? { totalEarned: 0, totalRefereeDeposited: 0, count: 0 };
  const rewardPerEvent = Number(getSetting("referralRewardInr") || 0);

  res.json({
    status: true,
    data: {
      totalReferrals,
      totalEarned: myUser?.referralEarned ?? agg.totalEarned,
      totalRewardEvents: agg.count,
      totalRefereeDeposited: agg.totalRefereeDeposited,
      rewardPerEvent,
      recentRewards: recentRewards.map((r) => ({
        referee: r.referee,
        amount: r.amountInr,
        refereeAmount: r.refereeAmountInr,
        sourceType: r.sourceType,
        createdAt: r.createdAt,
      })),
    },
  });
});

/**
 * GET /api/affiliate/referrals
 *
 * Returns the list of users who registered via my referral link,
 * enriched with their total deposit activity and the INR I earned from them.
 */
affiliateRouter.get("/referrals", async (req, res) => {
  const me = req.authUserName!;

  const [referredUsers, depositsByUser] = await Promise.all([
    UserModel.find({ referrer: me })
      .select("userName createdAt lastLoginAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    ReferralRewardModel.aggregate([
      { $match: { referrer: me } },
      {
        $group: {
          _id: "$referee",
          totalDeposited: { $sum: "$refereeAmountInr" },
          rewardCount: { $sum: 1 },
          myEarned: { $sum: "$amountInr" },
        },
      },
    ]),
  ]);

  const depositMap = new Map<
    string,
    { totalDeposited: number; rewardCount: number; myEarned: number }
  >();
  for (const d of depositsByUser) {
    depositMap.set(d._id, {
      totalDeposited: d.totalDeposited,
      rewardCount: d.rewardCount,
      myEarned: d.myEarned,
    });
  }

  res.json({
    status: true,
    data: referredUsers.map((u) => ({
      userName: u.userName,
      joinedAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      totalDeposited: depositMap.get(u.userName)?.totalDeposited ?? 0,
      myEarnedFromUser: depositMap.get(u.userName)?.myEarned ?? 0,
      rewardCount: depositMap.get(u.userName)?.rewardCount ?? 0,
    })),
  });
});
