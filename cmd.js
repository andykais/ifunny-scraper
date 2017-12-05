const program = require('commander')
const { homedir } = require('os')
const { resolve } = require('path')
const run = require('./index.js')

program
  .usage('<username>')
  .option('-s, --save-folder <folder>', 'Location files will be saved to')
  .parse(process.argv)

if (!program.args.length) program.help()
program.saveFolder = program.saveFolder || resolve(homedir(), `${program.args[0]}_ifunny_account`)

run({
  profile: program.args[0],
  save: (...partials) => resolve(program.saveFolder, ...partials)
})
