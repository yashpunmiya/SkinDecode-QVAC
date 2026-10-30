const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function normalizedPath(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function shortWindowsProjectPath(projectRoot) {
  const candidates = ['sd', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 'q1', 'q2'];
  for (const name of candidates) {
    const alias = `${path.parse(projectRoot).root}${name}`;
    try {
      if (fs.existsSync(alias)) {
        if (fs.lstatSync(alias).isSymbolicLink() && normalizedPath(fs.realpathSync(alias)) === normalizedPath(projectRoot)) {
          return { alias, created: false };
        }
        continue;
      }
      fs.symlinkSync(projectRoot, alias, 'junction');
      return { alias, created: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not create a short Windows junction for the Android build.');
}

function clearStaleAndroidAutolinking(projectRoot) {
  const generatedPaths = [
    path.join(projectRoot, 'android', 'build', 'generated', 'autolinking'),
    path.join(projectRoot, 'android', 'app', 'build', 'generated', 'autolinking'),
  ];
  for (const generatedPath of generatedPaths) {
    const relative = path.relative(projectRoot, generatedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to clear Android build output outside the project: ${generatedPath}`);
    }
    if (fs.existsSync(generatedPath)) {
      if (fs.lstatSync(generatedPath).isSymbolicLink()) {
        throw new Error(`Refusing to clear a linked Android build output: ${generatedPath}`);
      }
      fs.rmSync(generatedPath, { recursive: true, force: true });
    }
  }
}

function normalizeWindowsQvacBundle(projectRoot) {
  if (process.platform !== 'win32') return;
  const relativeRoot = path.relative(path.parse(projectRoot).root, projectRoot).split(path.sep).join('/');
  const hostNodeModulesPrefix = `/../${relativeRoot}/node_modules/`;
  const bundlePath = path.join(projectRoot, 'qvac', 'worker.bundle.js');
  const mobileBundlePath = path.join(projectRoot, 'node_modules', '@qvac', 'sdk', 'dist', 'worker.mobile.bundle.js');
  const source = fs.readFileSync(bundlePath, 'utf8');
  const modulePrefix = 'module.exports = ';
  if (!source.startsWith(modulePrefix)) throw new Error('QVAC generated an unexpected mobile bundle wrapper.');
  const bundle = JSON.parse(source.slice(modulePrefix.length).trim());
  const hostFileUrlPrefix = `file:///${path.parse(projectRoot).root.replace(/\\/g, '/')}${relativeRoot}/node_modules/`;
  if (!bundle.includes(hostNodeModulesPrefix) && !bundle.includes(hostFileUrlPrefix)) {
    throw new Error(`QVAC mobile bundle did not contain the expected Windows module path (${hostNodeModulesPrefix}).`);
  }
  const headerStart = bundle.indexOf('\n') + 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let headerEnd = -1;
  for (let index = headerStart; index < bundle.length; index += 1) {
    const character = bundle[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      headerEnd = index + 1;
      break;
    }
  }
  if (headerEnd < 0) throw new Error('QVAC mobile bundle has an invalid JSON header.');

  // Rewrite module IDs in BarePack's JSON resolution table only. The bundle
  // header is length-prefixed, so updating the module must also update its byte
  // length; a raw string replacement corrupts the header and crashes BareKit.
  const portableHeaderText = bundle.slice(headerStart, headerEnd)
    .split(hostNodeModulesPrefix).join('/node_modules/')
    .split(hostFileUrlPrefix).join('/node_modules/');
  JSON.parse(portableHeaderText);
  // Bare's length includes both newline delimiters around its JSON header.
  const portableHeaderLength = Buffer.byteLength(`\n${portableHeaderText}\n`);
  const portableBundle = `${portableHeaderLength}\n${portableHeaderText}${bundle.slice(headerEnd)}`;
  const bareBundle = require('bare-bundle');
  const parsedBundle = bareBundle.from(Buffer.from(portableBundle));
  for (const filePath of parsedBundle.keys()) {
    if (!/\.(?:m?js|json)$/.test(filePath)) continue;
    const data = parsedBundle.read(filePath);
    const text = data.toString('utf8');
    const normalized = text
      .split(hostNodeModulesPrefix).join('/node_modules/')
      .split(hostFileUrlPrefix).join('/node_modules/');
    if (normalized !== text) parsedBundle.write(filePath, Buffer.from(normalized), { mode: parsedBundle.mode(filePath) });
    if (filePath.endsWith('/package.json')) JSON.parse(normalized);
  }
  // Re-serialize through BarePack so changed entry-module paths also update
  // every file offset and length in the bundle header.
  const rebuiltBundle = parsedBundle.toBuffer().toString('utf8');
  bareBundle.from(Buffer.from(rebuiltBundle));
  const portableSource = `${modulePrefix}${JSON.stringify(rebuiltBundle)}\n`;
  // Keep QVAC's source artifact and the copy embedded into the Android APK in sync.
  fs.writeFileSync(bundlePath, portableSource);
  fs.writeFileSync(mobileBundlePath, portableSource);
}

function run() {
  const prebuildOnly = process.argv.includes('--prebuild');
  const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
  if (prebuildOnly && process.platform === 'win32') clearStaleAndroidAutolinking(projectRoot);
  let cwd = projectRoot;
  let createdAlias = false;
  let alias;
  const env = { ...process.env };

  if (process.platform === 'win32') {
    ({ alias, created: createdAlias } = shortWindowsProjectPath(projectRoot));
    cwd = alias;
    const nodeOptions = env.NODE_OPTIONS || '';
    if (!/(^|\s)--preserve-symlinks(?:\s|$)/.test(nodeOptions)) {
      env.NODE_OPTIONS = `${nodeOptions} --preserve-symlinks`.trim();
    }
  }

  const [major, minor] = process.versions.node.split('.').map(Number);
  const qvacBundlerSupportsNode = (major === 22 && minor >= 21) || major > 24 || (major === 24 && minor >= 9);
  const qvacBundlerNeedsNewerNode = prebuildOnly && !qvacBundlerSupportsNode;
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const expoArgs = prebuildOnly ? ['expo', 'prebuild', '--platform', 'android'] : ['expo', 'run:android'];
  // Use npm exec's explicit `--` separator. A quoted `-c` command is split by
  // cmd.exe on Windows and causes npm EUSAGE before Expo can start.
  const args = qvacBundlerNeedsNewerNode
    ? ['--yes', '--package=node@22.21.0', '--', 'node', './node_modules/expo/bin/cli', ...expoArgs.slice(1)]
    : expoArgs;

  let status = 1;
  try {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error) throw result.error;
    status = result.status ?? 1;
    if (prebuildOnly && status === 0) normalizeWindowsQvacBundle(projectRoot);
    if (prebuildOnly && status === 0) {
      // Expo prebuild can leave Gradle's generated autolinking Java source
      // cached against an older Android package name. Remove those build
      // outputs before the next `expo run:android` compiles the new project.
      const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
      const clean = spawnSync(gradleCommand, ['clean', '--no-build-cache'], {
        cwd: path.join(cwd, 'android'), env, stdio: 'inherit', shell: process.platform === 'win32',
      });
      if (clean.error) throw clean.error;
      status = clean.status ?? 1;
    }
  } finally {
    if (createdAlias) fs.rmdirSync(alias);
  }
  process.exitCode = status;
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
