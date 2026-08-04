#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  fgBlack: '\x1b[30m',
  fgRed: '\x1b[31m',
  fgGreen: '\x1b[32m',
  fgYellow: '\x1b[33m',
  fgBlue: '\x1b[34m',
  fgMagenta: '\x1b[35m',
  fgCyan: '\x1b[36m',
  fgWhite: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

function printBanner() {
  console.clear();
  console.log(`${colors.fgCyan}${colors.bright}====================================================${colors.reset}`);
  console.log(`${colors.fgCyan}${colors.bright}      QueueCTL - CLI Background Job Queue Runner     ${colors.reset}`);
  console.log(`${colors.fgCyan}${colors.bright}====================================================${colors.reset}`);
  console.log(`${colors.fgYellow}Stack: Node.js, SQLite, Express, Commander.js${colors.reset}\n`);
}

// Detect package manager (prefers pnpm if pnpm-lock.yaml is present and pnpm is installed, otherwise npm)
function getPackageManager() {
  let hasPnpm = false;
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    hasPnpm = true;
  } catch (e) {
    hasPnpm = false;
  }
  return hasPnpm ? 'pnpm' : 'npm';
}

const pm = getPackageManager();

function checkDependencies() {
  if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
    console.log(`${colors.fgYellow}Warning: node_modules directory not found.${colors.reset}`);
    console.log(`Running installation using ${colors.fgGreen}${pm}${colors.reset}...`);
    try {
      execSync(`${pm} install`, { stdio: 'inherit' });
      console.log(`${colors.fgGreen}✔ Dependencies installed successfully!${colors.reset}\n`);
    } catch (err) {
      console.error(`${colors.fgRed}Failed to install dependencies: ${err.message}${colors.reset}`);
      process.exit(1);
    }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  printBanner();
  checkDependencies();

  while (true) {
    printBanner();
    console.log(`${colors.bright}Please select an option to run:${colors.reset}`);
    console.log(`1. ${colors.fgGreen}Run Smoke Demo${colors.reset} (run scripts/demo.js)`);
    console.log(`2. ${colors.fgGreen}Run Automated Tests${colors.reset} (node --test)`);
    console.log(`3. ${colors.fgGreen}Start Web Dashboard${colors.reset} (http://localhost:3000)`);
    console.log(`4. ${colors.fgGreen}Start Background Workers${colors.reset} (starts workers)`);
    console.log(`5. ${colors.fgGreen}Check Queue Status${colors.reset} (runs queuectl status)`);
    console.log(`6. ${colors.fgGreen}Run Custom CLI Command${colors.reset} (e.g. enqueue a job)`);
    console.log(`7. ${colors.fgRed}Exit${colors.reset}`);
    console.log();

    const choice = await askQuestion(`${colors.bright}Enter choice (1-7): ${colors.reset}`);
    console.log();

    switch (choice.trim()) {
      case '1':
        console.log(`${colors.fgCyan}Running Smoke Demo...${colors.reset}`);
        try {
          execSync(`node scripts/demo.js`, { stdio: 'inherit' });
        } catch (e) {
          console.error(`${colors.fgRed}Demo failed.${colors.reset}`);
        }
        await askQuestion(`\nPress Enter to return to menu...`);
        break;
      case '2':
        console.log(`${colors.fgCyan}Running Automated Tests...${colors.reset}`);
        try {
          execSync(`node --test`, { stdio: 'inherit' });
        } catch (e) {
          console.error(`${colors.fgRed}Tests failed.${colors.reset}`);
        }
        await askQuestion(`\nPress Enter to return to menu...`);
        break;
      case '3':
        await startDashboard();
        break;
      case '4':
        await startWorkers();
        break;
      case '5':
        console.log(`${colors.fgCyan}Checking status...${colors.reset}`);
        try {
          execSync(`node bin/queuectl.js status`, { stdio: 'inherit' });
        } catch (e) {
          console.error(`${colors.fgRed}Failed to get status.${colors.reset}`);
        }
        await askQuestion(`\nPress Enter to return to menu...`);
        break;
      case '6':
        console.log(`${colors.bright}Subcommands available:${colors.reset}`);
        console.log(`  enqueue <json_job>   e.g., '{"id":"job1","command":"echo hello"}'`);
        console.log(`  worker start         Start workers (--count <num>)`);
        console.log(`  worker stop          Stop background workers gracefully`);
        console.log(`  status               View short queue statistics`);
        console.log(`  list                 List jobs (--state pending|processing|completed|failed|dead)`);
        console.log(`  logs <job_id>        Print logs for a job`);
        console.log(`  dlq list             List dead letter queue jobs`);
        console.log(`  dlq retry <job_id>   Requeue a dead job`);
        console.log(`  config set <k> <v>   Set max-retries / backoff-base`);
        console.log();
        const cmdArgs = await askQuestion(`${colors.bright}Enter queuectl subcommand and args:\n> node bin/queuectl.js ${colors.reset}`);
        if (cmdArgs.trim()) {
          try {
            execSync(`node bin/queuectl.js ${cmdArgs}`, { stdio: 'inherit' });
          } catch (e) {
            console.error(`${colors.fgRed}Command failed.${colors.reset}`);
          }
        }
        await askQuestion(`\nPress Enter to return to menu...`);
        break;
      case '7':
        console.log('Goodbye!');
        rl.close();
        process.exit(0);
      default:
        console.log(`${colors.fgRed}Invalid option. Please try again.${colors.reset}`);
        await new Promise(r => setTimeout(r, 1000));
        break;
    }
  }
}

function startDashboard() {
  return new Promise(async (resolve) => {
    console.log(`${colors.fgCyan}Starting Dashboard...${colors.reset}`);
    const dashboardProcess = spawn('node', ['src/dashboard.js'], { stdio: 'inherit' });
    
    console.log(`${colors.fgGreen}Dashboard process started.${colors.reset}`);
    console.log(`You can open http://localhost:3000 in your browser.`);
    
    // Automatically attempt to open the browser
    const url = 'http://localhost:3000';
    try {
      const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      if (process.platform === 'win32') {
        spawn('cmd', ['/c', `start ${url}`]);
      } else {
        spawn(openCmd, [url]);
      }
    } catch (e) {
      // ignore browser open errors
    }

    console.log(`${colors.fgYellow}Press Ctrl+C in this terminal (or close it) to stop the dashboard.${colors.reset}`);
    
    // Setup clean shutdown on exit of runner
    const cleanup = () => {
      try {
        dashboardProcess.kill();
      } catch (e) {}
    };
    process.on('exit', cleanup);
    
    // Let user press Enter to return to menu (this will stop the dashboard)
    await askQuestion(`\nPress Enter to STOP the dashboard and return to the main menu...\n`);
    
    cleanup();
    process.off('exit', cleanup);
    resolve();
  });
}

function startWorkers() {
  return new Promise(async (resolve) => {
    const countStr = await askQuestion(`${colors.bright}Enter number of background workers to start [3]: ${colors.reset}`);
    const count = parseInt(countStr.trim()) || 3;
    
    console.log(`${colors.fgCyan}Starting ${count} worker processes...${colors.reset}`);
    const workerProcess = spawn('node', ['bin/queuectl.js', 'worker', 'start', '--count', count.toString()], { stdio: 'inherit' });

    console.log(`${colors.fgYellow}Workers are running in the background. Press Enter to STOP workers and return to menu...${colors.reset}`);
    
    const cleanup = () => {
      try {
        // Send stop command to workers gracefully
        console.log(`${colors.fgCyan}Sending stop command to workers...${colors.reset}`);
        execSync('node bin/queuectl.js worker stop');
        workerProcess.kill();
      } catch (e) {}
    };
    process.on('exit', cleanup);
    
    await askQuestion('');
    
    cleanup();
    process.off('exit', cleanup);
    resolve();
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
