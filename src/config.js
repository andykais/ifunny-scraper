const { cwd } = require('process')
const { resolve } = require('path')

module.exports = ({ username, saveFolder = `${cwd()}/ifunny_accounts` }) => ({
  username,
  baseUrl: 'https://ifunny.co',
  paths: {
    basedir: resolve(saveFolder),
    userdir: resolve(saveFolder, username),
    media: resolve(saveFolder, username, 'media'),
    cache: resolve(saveFolder, username, 'cache'),
    database: resolve(saveFolder, username, 'database.json')
  },
  debug: process.env.DEBUG === 'true'
})
