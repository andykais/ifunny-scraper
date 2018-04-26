#!/bin/env node

const program = require('commander')
const chalk = require('chalk')
const generateConfig = require('../src/config')

// set up listeners
process.on('unhandledRejection', err => {
  console.error(chalk.red(err.stack))
  process.exit(1)
})

program
  .usage('<username>')
  .option('-s, --save-folder <folder>', 'Location files will be saved to')
  .parse(process.argv)

if (!program.args.length) program.help()

const config = generateConfig({
  username: program.args[0],
  ...program
})

const run = require('../src/index')
run(config)
