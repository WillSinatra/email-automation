const { spawn } = require('child_process');

const isWin = process.platform === 'win32';
const node = process.execPath || (isWin ? 'node.exe' : 'node');
const npm = process.env.npm_execpath || (isWin ? 'npm.cmd' : 'npm');

function run(command, args, label) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`\n[${label}] exited with code ${code ?? signal}`);
      process.exit(code || 1);
    }
  });

  return child;
}

const backend = run(node, ['backend/index.js'], 'backend');
const frontend = run(npm, ['--prefix', 'frontend', 'run', 'dev'], 'frontend');

function stopAll() {
  backend.kill('SIGTERM');
  frontend.kill('SIGTERM');
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});
