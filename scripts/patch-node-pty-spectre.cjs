const fs = require('node:fs');
const path = require('node:path');

const files = [
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'binding.gyp'),
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'deps', 'winpty', 'src', 'winpty.gyp')
];

const spectreBlockPattern =
  /\r?\n\s*'msvs_configuration_attributes'\s*:\s*\{\s*\r?\n\s*'SpectreMitigation'\s*:\s*'Spectre'\s*\r?\n\s*\},?/g;

let patched = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    continue;
  }

  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(spectreBlockPattern, '');

  if (after !== before) {
    fs.writeFileSync(file, after);
    patched += 1;
  }
}

console.log(
  patched === 0
    ? 'node-pty Spectre mitigation patch already applied.'
    : `Removed node-pty Spectre mitigation settings from ${patched} file(s).`
);
