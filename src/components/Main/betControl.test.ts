import { getPostCashoutBetState } from "./betControl";

describe("bet control state", () => {
  test("releases the current hand after cashout so the next bet can be prepared", () => {
    expect(getPostCashoutBetState("f")).toEqual({ fbetted: false });
    expect(getPostCashoutBetState("s")).toEqual({ sbetted: false });
  });
});
