const Rx = require('rxjs')
const EventEmitter = require('events')

class Queuer {
  constructor ({ maxConcurrent = 1, debug = false } = {}) {
    // node event emitter
    const queueEmitter = new EventEmitter()

    // listen to `queueEmitter` for a stream of inputs
    const source = Rx.Observable.fromEvent(queueEmitter, 'data')
      // stop accepting new values after 'stop' event is emitted
      .takeUntil(Rx.Observable.fromEvent(queueEmitter, 'stop'))
      // concurrently run 'maxConcurrent' promises together until there is nothing in the stream
      .mergeMap(x => x(), maxConcurrent)

    // this promise is necessary because source.toPromise() doesnt work on `fromEvent` observables
    const completionPromise = new Promise((resolve, reject) =>
      source.subscribe(
        x => debug && console.log(`value: ${x}`),
        e => reject(e),
        _ => resolve()
      )
    )
    this.queueEmitter = queueEmitter
    this.source = source
    this.completionPromise = completionPromise
  }

  addTask (promise) {
    this.queueEmitter.emit('data', promise)
  }

  finishTasks () {
    this.queueEmitter.emit('stop')
  }

  toPromise () {
    // the promise is unusable without first calling this method [stack explaination](https://stackoverflow.com/q/46966890/3795137)
    this.finishTasks()
    return this.completionPromise
  }
}
module.exports = Queuer

/* Usage Example
const timeout = (n) => new Promise((resolve, reject) => setTimeout(() => resolve(n), n))
const test = async () => {
  const queue = new Queuer({ maxConcurrent: 2, debug: true })
  queue.addTask(() => timeout(25))
  queue.addTask(() => timeout(250))
  queue.addTask(() => timeout(250))
  queue.addTask(() => timeout(250))
  queue.addTask(() => timeout(250))
  queue.addTask(() => timeout(250))
  await timeout(2000) // doesnt matter what side effects happen after initializing
  queue.addTask(() => timeout(250))
  queue.addTask(() => timeout(250))
  await queue.toPromise()
  console.log('done.')
}
test()
*/
