const path = require('path')
const fs = require('fs')
const { promisify } = require('util')

const [mkdir] = [fs.mkdir].map(promisify)

// same functionality as mkdir -p
const mkdirp = folder =>
  mkdir(folder).catch(err => {
    if (err.code === 'ENOENT') {
      return mkdirp(path.dirname(folder)).then(() => mkdir(folder))
    } else if (err.code !== 'EEXIST') {
      throw err
    }
  })
module.exports = mkdirp
