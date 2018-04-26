const chalk = require('chalk')
const { readFile, writeFile } = require('fs')
const { promisify } = require('util')
const [read, write] = [readFile, writeFile].map(f => promisify(f))

class Logger {
  _printProgress() {
    const logMessage = `downloaded ${this.stats.total} memes (${
      this.stats.inProgress.image
    } images & ${this.stats.inProgress.video} videos queued) while ${
      this.stats.inProgress.page
    } pages are downloading.`
    if (this.showDebug) this.debug(logMessage)
    else process.stdout.write(`\r${logMessage}`)
  }

  recordStatsFor({ type, completed = false }) {
    if (completed) {
      this.stats.inProgress[type]--
      this.stats.total += type !== 'page'
    } else {
      this.stats.inProgress[type]++
    }
    this._printProgress()
  }

  logWrapper(messages, { color = chalk, prefix = '' }) {
    const error = new Error()
    const caller_line = error.stack.split('\n')[3]
    const index = caller_line.indexOf('at ')
    const clean = caller_line.slice(index + 3, caller_line.length)
    console.log(prefix, color(clean))
    console.group()
    console.log(...messages)
    console.groupEnd()
    console.log()
  }
  debug(...args) {
    if (this.showDebug) {
      this.logWrapper(args, { prefix: '[dbg]' })
    }
  }
  info(...args) {
    // until I have a better solution, hide info logs when debug logs are shown
    if (!this.showDebug) {
      console.log(...args)
    }
  }
  error(...args) {
    this.logWrapper(args, { color: chalk.red, prefix: '[err]' })
  }
  constructor() {
    this.showDebug = process.env.DEBUG === 'true'
    this.stats = {
      inProgress: {
        page: 0,
        video: 0,
        gif: 0,
        image: 0
      },
      total: 0
    }
  }
}

let loggerSingleton = null

// Logger class singleton factory
module.exports = () => {
  if (loggerSingleton) return loggerSingleton

  loggerSingleton = new Logger()
  return loggerSingleton
}
