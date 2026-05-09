/**
 * One-shot CLI to create OR promote an admin user.
 * Run inside the api container:
 *   docker compose exec api node dist/cli/make-admin.js <userName> <password>
 *
 * If the user exists: flips isAdmin=true and (optionally) resets password.
 * If they don't exist: creates them with isAdmin=true.
 *
 * Idempotent — safe to run multiple times.
 */
import bcrypt from "bcryptjs";
import { connectDb } from "../db/connection";
import { UserModel } from "../db/models/User";
import { config } from "../config";

const main = async () => {
  const [userName, password] = process.argv.slice(2);
  if (!userName || !password) {
    console.error("usage: make-admin <userName> <password>");
    process.exit(2);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters");
    process.exit(2);
  }

  await connectDb();

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await UserModel.findOne({ userName });

  if (existing) {
    existing.isAdmin = true;
    existing.passwordHash = passwordHash;
    existing.banned = false;
    await existing.save();
    console.log(`✓ Promoted existing user "${userName}" to admin and reset password.`);
  } else {
    await UserModel.create({
      userName,
      passwordHash,
      isAdmin: true,
      balance: config.initialBalance,
      avatar: "av-1.png",
    });
    console.log(`✓ Created new admin user "${userName}".`);
  }
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
