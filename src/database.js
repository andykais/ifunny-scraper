const { basename, resolve } = require('path')
const { readFile, writeFile } = require('fs')
const { promisify } = require('util')
const getLoggerSingleton = require('./logger')

const [read, write] = [readFile, writeFile].map(f => promisify(f))

const logger = getLoggerSingleton()

const knownSourceProviders = ['instagram', 'coub', 'play_large', 'vine']

class Database {
  constructor(config, database) {
    const entriesMap = database.entries.reduce((acc, meme) => {
      acc[meme.pageUri] = meme
      return acc
    }, {})

    Object.assign(this, {
      config,
      database,
      entriesMap
    })
  }
  async persist() {
    await write(this.config.paths.database, JSON.stringify(this.database, null, 2))
    logger.debug(`persisted ${this.database.entries.length} meme entries.`)
  }
  createEntry(pageUri) {
    if (this.isMemeCached(pageUri))
      throw new Error(`Meme already downloaded, dont create another! (${pageUri})`)
    const freshMeme = this._templateMeme(pageUri)
    this.database.entries.push(freshMeme)
    this.entriesMap[pageUri] = freshMeme
    this.database.counts.smallestIndex--
  }
  assignToEntry(pageUri, obj) {
    if (obj.sourceProvider && !knownSourceProviders.includes(obj.sourceProvider)) {
      throw new Error(`unhandled video type "${obj.sourceProvider}" from ${pageUri}`)
    }
    Object.assign(this.entriesMap[pageUri], obj)
  }

  setTotalApproximation(memeCount) {
    this.database.counts.approximateTotal = memeCount
    this.database.counts.smallestIndex = memeCount
  }

  get(pageUri) {
    if (!this.entriesMap[pageUri]) throw new Error(`No meme recorded for ${pageUri}!`)
    return this.entriesMap[pageUri]
  }
  getSourceFileDest(pageUri) {
    if (!this.entriesMap[pageUri]) throw new Error(`No meme recorded for ${pageUri}!`)
    const { sourceUrl, index } = this.entriesMap[pageUri]
    if (!sourceUrl) throw new Error(`missing sourceUrl in ${this.entriesMap[pageUri]}`)
    return resolve(
      this.config.paths.media,
      `${index.toString().padStart(4, 0)}-${basename(sourceUrl)}`
    )
  }

  _templateMeme(pageUri) {
    return {
      pageUri, // uri excluding the baseUrl
      downloaded: false, // flag is set once the actual media content is written to file
      tags: [],
      batchID: null, // links come in batches of html from ifunny, this groups them into their respective grids
      type: null, // video, gif or image
      sourceUrl: null, // source url on ifunny of the media
      sourceProvider: null, // e.g. instagram, coub, vine etc
      sourceProviderLocation: null, // url to the original post on the respective source provider site
      // index: this.database.entries.length // upward counting id of each meme
      index: this.database.counts.smallestIndex // downward counting id of each meme
    }
  }
  isMemeCached(page) {
    return Boolean(this.entriesMap[page] && this.entriesMap[page].downloaded)
  }
}

module.exports = async config => {
  const fallbackDatabase = { entries: [], counts: { approximateTotal: null, smallestIndex: null } }
  const databaseObj = await read(config.paths.database)
    .then(JSON.parse)
    .catch(() => fallbackDatabase)
  // count how many downloads already finised for stats
  logger.stats.total = databaseObj.entries.filter(e => e.downloaded).length
  return new Database(config, databaseObj)
}
