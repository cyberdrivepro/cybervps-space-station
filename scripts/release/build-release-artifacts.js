/**
 * CYBERVPS SPACE STATION - UNIVERSAL RELEASE PACKAGER & ARTIFACT BUILDER
 *
 * Compiles and builds:
 * 1. Modular Web Dashboard -> Canonical apps/dashboard/index.html & index.html
 * 2. Native Windows Executables (.EXE) via 64-bit C# Compiler (csc.exe):
 *    - CyberVPS-Setup-x64.exe (Universal Dual-Mode asInvoker)
 *    - CyberVPS-Setup-Admin-x64.exe (Administrator UAC requireAdministrator)
 *    - CyberVPS-Setup-User-x64.exe (Standard User asInvoker)
 * 3. Native Windows Installer (.MSI) via COM WindowsInstaller.Installer database generator:
 *    - CyberVPS-Host-Agent-x64.msi (Enterprise GPO / Intune / SCCM silent deployment)
 * 4. Authoritative Checksums (SHA-256) & Release Manifest JSON
 * 5. Runs automated validation tests to verify zero packaging regressions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function buildReleaseArtifacts() {
  console.log('================================================================');
  console.log('🚀 CYBERVPS SPACE STATION - FULL RELEASE PACKAGING PIPELINE');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const distDir = path.join(rootDir, 'dist/windows');

  // Step 1: Build & Bundle Modular Frontend Dashboard
  console.log('[*] Step 1: Compiling Modular Web Dashboard...');
  const buildDashScript = path.join(rootDir, 'scripts/build-dashboard.js');
  const dashOutput = execSync(`node "${buildDashScript}"`, { cwd: rootDir, encoding: 'utf8' });
  console.log(dashOutput.trim());

  // Step 2: Build Native Windows Installers (EXE & MSI)
  console.log('\n[*] Step 2: Compiling Windows .EXE Bootstrappers & .MSI Installer...');
  const buildPs1 = path.join(rootDir, 'installers/windows/build-windows-installers.ps1');
  const buildOutput = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${buildPs1}"`, {
    cwd: rootDir,
    encoding: 'utf8'
  });
  console.log(buildOutput.trim());

  // Step 3: Validate Artifacts & SHA-256 Integrity
  console.log('\n[*] Step 3: Verifying Release Artifacts Integrity...');
  const expectedArtifacts = [
    'CyberVPS-Setup-x64.exe',
    'CyberVPS-Setup-Admin-x64.exe',
    'CyberVPS-Setup-User-x64.exe',
    'CyberVPS-Host-Agent-x64.msi',
    'checksums.sha256',
    'release-manifest.json'
  ];

  for (const file of expectedArtifacts) {
    const fullPath = path.join(distDir, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Expected release artifact missing: ${fullPath}`);
    }
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      throw new Error(`Release artifact is empty (0 bytes): ${fullPath}`);
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
    console.log(`  ✓ ${file.padEnd(30)} ${String((stat.size / 1024).toFixed(1) + ' KB').padStart(10)} [SHA256: ${hash.substring(0, 16)}...]`);
  }

  // Step 4: Run Verification Tests
  console.log('\n[*] Step 4: Running Automated Regression Tests on Release Artifacts...');
  const lifecycleTest = execSync(`node "${path.join(rootDir, 'tests/test-lifecycle-and-windows-installer.js')}"`, {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (!lifecycleTest.includes('ALL LIFECYCLE & WINDOWS INSTALLER TESTS PASSED')) {
    throw new Error('Lifecycle and Windows installer tests failed');
  }
  console.log('  ✓ Lifecycle and Windows Installer Verification Tests Passed.');

  const msiTest = execSync(`node "${path.join(rootDir, 'tests/test-hardcore-executable-and-msi.js')}"`, {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (!msiTest.includes('ALL HARDCORE EXECUTABLE & MSI EXECUTION TESTS PASSED')) {
    throw new Error('Hardcore executable and MSI tests failed');
  }
  console.log('  ✓ Hardcore PE & MSI Process Execution Tests Passed.');

  console.log('\n================================================================');
  console.log('🎉 ALL RELEASE ARTIFACTS COMPILED, VERIFIED & PACKAGED WITH ZERO ERRORS!');
  console.log('================================================================\n');
}

if (require.main === module) {
  try {
    buildReleaseArtifacts();
  } catch (err) {
    console.error('\n❌ Release packaging failed:', err.message);
    process.exit(1);
  }
}

module.exports = { buildReleaseArtifacts };
