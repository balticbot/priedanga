/**
 * Config plugin: make sure the path in Xcode's "Bundle React Native code and
 * images" build phase is quoted. Some template versions run it as a bare
 * `...` command substitution (or as "`...`", which bash does not reliably
 * keep as one word), which breaks when the project lives in a folder whose
 * path contains a space. Rewrites either form to "$(...)".
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

// Matches the substitution as stored in project.pbxproj (quotes are escaped as \").
const PATTERN =
  /(?:\\")?`(\\"\$NODE_BINARY\\" --print \\"require\('path'\)\.dirname\(require\.resolve\('react-native\/package\.json'\)\) \+ '\/scripts\/react-native-xcode\.sh'\\")`(?:\\")?/;

module.exports = function withQuotedBundleScript(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const dir = cfg.modRequest.platformProjectRoot;
      const proj = fs.readdirSync(dir).find((f) => f.endsWith('.xcodeproj'));
      if (!proj) return cfg;
      const file = path.join(dir, proj, 'project.pbxproj');
      const src = fs.readFileSync(file, 'utf8');
      const patched = src.replace(PATTERN, (_m, inner) => `\\"$(${inner})\\"`);
      if (patched !== src) fs.writeFileSync(file, patched);
      return cfg;
    },
  ]);
};
