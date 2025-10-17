import chalk from 'chalk';
import ora from 'ora';

class Logger {
  constructor() {
    this.spinner = null;
  }

  info(message) {
    console.log(chalk.blue('ℹ'), message);
  }

  success(message) {
    console.log(chalk.green('✓'), message);
  }

  error(message) {
    console.log(chalk.red('✗'), message);
  }

  warning(message) {
    console.log(chalk.yellow('⚠'), message);
  }

  startSpinner(message) {
    this.spinner = ora(message).start();
  }

  updateSpinner(message) {
    if (this.spinner) {
      this.spinner.text = message;
    }
  }

  stopSpinner(success = true, message = '') {
    if (this.spinner) {
      if (success) {
        this.spinner.succeed(message);
      } else {
        this.spinner.fail(message);
      }
      this.spinner = null;
    }
  }

  progress(current, total, item = '') {
    const percentage = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percentage / 2)) + '░'.repeat(50 - Math.floor(percentage / 2));
    console.log(chalk.cyan(`[${bar}] ${percentage}%`) + (item ? ` - ${item}` : ''));
  }
}

export default new Logger();
