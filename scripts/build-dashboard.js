/**
 * CYBERVPS SPACE STATION - DETERMINISTIC DASHBOARD COMPILER & BUNDLER
 * Compiles modular src/ into canonical distribution index.html files
 */

const fs = require('fs');
const path = require('path');

function build() {
  console.log('================================================================');
  console.log('🔨 BUILDING CYBERVPS SPACE STATION MODULAR FRONTEND');
  console.log('================================================================');

  const srcDir = path.join(__dirname, '../apps/dashboard/src');
  const targetAppsHtml = path.join(__dirname, '../apps/dashboard/index.html');
  const targetRootHtml = path.join(__dirname, '../index.html');

  // Load modular source files
  const modules = [
    'core/state.js',
    'core/api-client.js',
    'core/router.js',
    'core/theme.js',
    'modules/fleet-view.js',
    'modules/terminal-view.js',
    'modules/file-manager-view.js',
    'modules/doctor-view.js',
    'modules/cluster-ha-view.js'
  ];

  let bundledJs = '';
  for (const m of modules) {
    const fullPath = path.join(srcDir, m);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      bundledJs += `\n/* --- ${m} --- */\n${content}\n`;
      console.log(`  📦 Bundled module: ${m} (${content.length} bytes)`);
    } else {
      console.warn(`  ⚠️ Module not found: ${m}`);
    }
  }

  // Preserve existing head, styles, and body template from existing index.html
  let existingHtml = '';
  if (fs.existsSync(targetAppsHtml)) {
    existingHtml = fs.readFileSync(targetAppsHtml, 'utf8');
  }

  // Inject or update the bundled modules script block before </body>
  const bundleMarkerStart = '<!-- BUNDLED_MODULES_START -->';
  const bundleMarkerEnd = '<!-- BUNDLED_MODULES_END -->';
  const injectedScriptBlock = `${bundleMarkerStart}\n<script>\n${bundledJs}\n</script>\n${bundleMarkerEnd}`;

  let finalHtml = existingHtml;
  if (finalHtml.includes(bundleMarkerStart) && finalHtml.includes(bundleMarkerEnd)) {
    const regex = new RegExp(`${bundleMarkerStart}[\\s\\S]*?${bundleMarkerEnd}`, 'g');
    finalHtml = finalHtml.replace(regex, injectedScriptBlock);
  } else if (finalHtml.includes('</body>')) {
    finalHtml = finalHtml.replace('</body>', `${injectedScriptBlock}\n</body>`);
  } else {
    finalHtml += `\n${injectedScriptBlock}`;
  }

  // Write to both canonical destinations
  fs.writeFileSync(targetAppsHtml, finalHtml, 'utf8');
  console.log(`  ✅ Written compiled dashboard to: ${targetAppsHtml}`);

  fs.writeFileSync(targetRootHtml, finalHtml, 'utf8');
  console.log(`  ✅ Written compiled dashboard to: ${targetRootHtml}`);

  console.log('================================================================');
  console.log('🎉 DASHBOARD COMPILATION COMPLETED SUCCESSFULLY');
  console.log('================================================================\n');
}

if (require.main === module) {
  build();
}

module.exports = { build };
