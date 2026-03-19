const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");

const { getRceditBundle } = require("app-builder-lib/out/toolsets/windows");

const execFileAsync = promisify(execFile);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const { packager, appOutDir } = context;
  const exeName = `${packager.appInfo.productFilename}.exe`;
  const exePath = path.join(appOutDir, exeName);
  const iconPath = await packager.getIconPath();
  const vendor = await getRceditBundle(packager.config.toolsets && packager.config.toolsets.winCodeSign);

  const args = [
    exePath,
    "--set-version-string",
    "FileDescription",
    packager.appInfo.productName,
    "--set-version-string",
    "ProductName",
    packager.appInfo.productName,
    "--set-version-string",
    "LegalCopyright",
    packager.appInfo.copyright,
    "--set-version-string",
    "InternalName",
    packager.appInfo.productFilename,
    "--set-version-string",
    "OriginalFilename",
    "",
    "--set-file-version",
    packager.appInfo.shortVersion || packager.appInfo.buildVersion,
    "--set-product-version",
    packager.appInfo.shortVersionWindows || packager.appInfo.getVersionInWeirdWindowsForm(),
  ];

  if (packager.appInfo.companyName) {
    args.push("--set-version-string", "CompanyName", packager.appInfo.companyName);
  }

  if (packager.platformSpecificBuildOptions.legalTrademarks) {
    args.push("--set-version-string", "LegalTrademarks", packager.platformSpecificBuildOptions.legalTrademarks);
  }

  if (packager.platformSpecificBuildOptions.requestedExecutionLevel) {
    const executionLevel = packager.platformSpecificBuildOptions.requestedExecutionLevel;
    if (executionLevel !== "asInvoker") {
      args.push("--set-requested-execution-level", executionLevel);
    }
  }

  if (iconPath) {
    args.push("--set-icon", iconPath);
  }

  await execFileAsync(vendor.x64, args);
};
