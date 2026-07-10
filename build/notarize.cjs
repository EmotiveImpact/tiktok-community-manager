/**
 * electron-builder afterSign hook — notarize + staple the signed .app.
 *
 * Reuses the studio-level notarization credential: the `vlume-notary` keychain
 * profile (an App Store Connect API key stored via `xcrun notarytool
 * store-credentials`). This is the same profile used to ship Vlume/Cairn — see
 * ~/mac-apps/SIGNING.md. App-specific passwords are intentionally NOT used
 * (they kept returning 401; the API key works first try).
 *
 * Runs after electron-builder signs the app but before it packages the dmg/zip,
 * so the stapled ticket is baked into BOTH artifacts. Result: the app opens
 * with zero Gatekeeper warnings on any customer's Mac.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const NOTARY_PROFILE = 'vlume-notary';

module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  // Allow skipping locally (fast, unsigned-for-me test builds) with SKIP_NOTARIZE=1.
  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('  • afterSign: SKIP_NOTARIZE=1 set — skipping notarization.');
    return;
  }

  const appName = context.packager.appInfo.productFilename; // "TikTok Community Manager"
  const appPath = path.join(appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    throw new Error(`afterSign: app not found at ${appPath}`);
  }

  const run = (cmd, args) => {
    console.log(`  $ ${cmd} ${args.join(' ')}`);
    return execFileSync(cmd, args, { stdio: 'inherit' });
  };

  // 1. Zip the signed app for submission (notarytool takes a zip/dmg/pkg).
  const zipPath = path.join(os.tmpdir(), `${appName.replace(/\s+/g, '_')}-notarize.zip`);
  console.log(`▸ Notarizing ${appName}.app via keychain profile "${NOTARY_PROFILE}"…`);
  run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);

  // 2. Submit + wait for Apple's verdict.
  run('xcrun', ['notarytool', 'submit', zipPath, '--keychain-profile', NOTARY_PROFILE, '--wait']);

  // 3. Staple the ticket into the .app so it validates offline.
  run('xcrun', ['stapler', 'staple', appPath]);
  run('xcrun', ['stapler', 'validate', appPath]);

  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
  console.log(`✓ Notarized + stapled ${appName}.app`);
};
