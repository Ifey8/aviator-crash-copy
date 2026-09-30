/**
 * (Re)generate an admin's Google Authenticator secret. Invalidates the old one.
 * Run inside the api container:
 *   docker compose exec api node dist/cli/admin-2fa-setup.js <userName>
 * Prints the otpauth:// URI — turn it into a QR / paste the secret into the app.
 */
import { connectDb } from "../db/connection";
import { UserModel } from "../db/models/User";
import { generateSecret, otpauthUri } from "../auth/totp";

const main = async () => {
  const [userName] = process.argv.slice(2);
  if (!userName) {
    console.error("usage: admin-2fa-setup <userName>");
    process.exit(2);
  }
  await connectDb();
  const user = await UserModel.findOne({ userName });
  if (!user || !user.isAdmin) {
    console.error(`"${userName}" is not an admin`);
    process.exit(1);
  }
  const secret = generateSecret();
  await UserModel.updateOne({ _id: user._id }, { $set: { totpSecret: secret }, $unset: { totpLastStep: 1 } });
  console.log(`secret: ${secret}`);
  console.log(`uri:    ${otpauthUri(secret, userName)}`);
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
