export type GamePhase = "BET" | "PLAYING" | "GAMEEND";
export type BetIndex = "f" | "s";

export interface BetSide {
  betted: boolean;
  cashouted: boolean;
  betAmount: number;
  cashAmount: number;
  cashOutAt: number;
  target: number;
  auto: boolean;
}

export interface PlayerState {
  userId: string;
  userName: string;
  avatar: string;
  balance: number;
  /** Outstanding playthrough requirement (INR). Withdrawable = balance − wagerRequired. */
  wagerRequired: number;
  userType: boolean;
  token: string;
  f: BetSide;
  s: BetSide;
}

export interface BettedUser {
  userName: string;
  avatar: string;
  betAmount: number;
  cashAmount: number;
  cashouted: boolean;
  cashOutAt: number;
  target: number;
}

export interface GameStatus {
  GameState: GamePhase;
  time: number;
  currentNum: string;
  currentSecondNum: number;
}

export const emptySide = (): BetSide => ({
  betted: false,
  cashouted: false,
  betAmount: 0,
  cashAmount: 0,
  cashOutAt: 0,
  target: 2,
  auto: false,
});
