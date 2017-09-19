/**
 * Created by Lyall, 14/9/2017
 */

const FS = require('fs');
const PATH = require('path');
const { debuglog, mkdir } = require('./utils');
const OperationQueueInFile = require('./operationQueueInFile');

const safeKey = (key) => {
    if (!key || typeof key !== 'string') return null;
    return key
        .replace(/\//g, '|||')
        .replace(/#/g, '___')
        .replace(/&/g, ':::')
        .replace(/ /g, '@@@');
};

// const originalKey = (safeKey) => {
//     if (!safeKey || typeof safeKey !== 'string') return null;
//     return safeKey
//         .replace(/___/g, '#')
//         .replace(/\|\|\|/g, '\\')
//         .replace(/:::/g, '&')
//         .replace(/@@@/g, ' ');
// };

class CacheInFile {
    constructor(options) {
        this.options = Object.assign({
            workdir: PATH.join(process.cwd(), 'tmp'),
            useMemCache: true,
            useFileCache: true,
            maxTTL: 86400 * 1000 * 7, // Max ttl of data produced by dead processes
        }, options);
        this.options.dataDir = PATH.join(this.options.workdir, 'data');

        this.cache = {};
        this.operationQueueClass = OperationQueueInFile;
        this.operationQueueOptions = {};
        this.operationQueue = null;
        this.processTag = null;

        // Create work&data directory
        [
            this.options.workdir,
            this.options.dataDir,
        ].forEach(dir => mkdir(dir));
    }

    // Initialize operation class and its options
    useOperationQueue(CustomOperationQueueClass, options) {
        if (typeof CustomOperationQueueClass === 'function') {
            this.operationQueueClass = CustomOperationQueueClass;
            if (typeof options === 'object') {
                this.operationQueueOptions = options;
            }
        }
    }

    async init() {
        if (!this.operationQueue) {
            const OperationQueueClass = this.operationQueueClass;
            this.operationQueue = new OperationQueueClass(this.operationQueueOptions);
            if (typeof this.operationQueue.init === 'function') {
                this.processTag = await this.operationQueue.init();
            } else {
                this.processTag = this.operationQueue.processTag;
            }
        }

        // Clear data produced by dead processes
        const datalist = FS.readdirSync(this.options.dataDir);
        datalist.forEach((itemKey) => {
            const filepath = PATH.join(this.options.dataDir, itemKey);
            try {
                const data = JSON.parse(FS.readFileSync(filepath));
                if (Date.now() - Number(data.arriveAt) > this.parseTtl(data.ttl)) {
                    FS.unlinkSync(filepath);
                }
            } catch (e) {
                if (FS.existsSync(filepath)) {
                    throw e;
                }
            }
        });
        return this.processTag;
    }

    // Return the real ttl number
    parseTtl(ttl) {
        if (!ttl) return this.options.maxTTL;
        let ttlNum = ttl;
        if (typeof ttl === 'string') ttlNum = Number(ttl);
        if (Number.isNaN(ttlNum) || ttlNum < 0) return this.options.maxTTL;
        return Math.min(ttlNum, this.options.maxTTL);
    }

    // Get file path for key
    keypath(key) {
        return PATH.join(this.options.dataDir, safeKey(key));
    }

    // Cache interfaces
    async get(key) {
        if (this.options.useMemCache && typeof this.cache[key] !== 'undefined') {
            return this.cache[key];
        } else if (this.options.useFileCache) {
            const self = this;
            const filepath = this.keypath(key);
            return new Promise((resolve, reject) => {
                const callback = (error) => {
                    if (error) reject(error);
                    else if (FS.existsSync(filepath)) {
                        const item = JSON.parse(FS.readFileSync(filepath));
                        if (Date.now() - Number(item.arriveAt) > self.parseTtl(item.ttl)) {
                            // Remove the data from disk
                            FS.unlinkSync(filepath);
                            resolve(null);
                        } else {
                            resolve(item.data);
                        }
                    } else {
                        resolve(null);
                    }
                };
                self.operationQueue.enqueue(callback);
            });
        }
        return null;
    }

    async set(key, value, ttl) {
        if (this.options.useFileCache) {
            const self = this;
            const filepath = this.keypath(key);
            return new Promise((resolve, reject) => {
                const callback = (error) => {
                    if (error) reject(error);
                    else {
                        if (self.options.useMemCache) {
                            self.cache[key] = value;
                        }
                        const item = {
                            arriveAt: Date.now(),
                            data: value,
                            processTag: self.processTag,
                        };
                        if (typeof ttl !== 'undefined') {
                            item.ttl = ttl;
                        }
                        try {
                            FS.writeFileSync(filepath, JSON.stringify(item));
                            // prepare reset
                            const timeout = Number(ttl);
                            if (!Number.isNaN(timeout) && timeout > 0) {
                                setTimeout(async () => {
                                    await self.reset(key);
                                }, timeout);
                            }
                            debuglog(`[${key}] is cached in file`);
                            resolve(true);
                        } catch (e) {
                            reject(e);
                        }
                    }
                };
                self.operationQueue.enqueue(callback);
            });
        } else if (this.options.useMemCache) {
            this.cache[key] = value;
            if (typeof ttl === 'number' && ttl > 0) {
                const self = this;
                setTimeout(async () => {
                    await self.reset(key);
                }, ttl);
            }
        }
        return true;
    }

    async reset(key) {
        if (this.options.useMemCache && typeof this.cache[key] !== 'undefined') {
            delete this.cache[key];
        }

        if (this.options.useFileCache) {
            const self = this;
            const filepath = this.keypath(key);
            return new Promise((resolve, reject) => {
                const callback = (error) => {
                    if (error) reject(error);
                    else {
                        try {
                            if (FS.existsSync(filepath)) {
                                FS.unlinkSync(filepath);
                            }
                        } catch (e) {
                            reject(e);
                        }
                    }
                };
                self.operationQueue.enqueue(callback);
            });
        }
        return true;
    }

    // Append an object at the end of an array
    // or add a property for an object
    // using initial value to indicate the original type
    // it could be an object, or an array both are ok
    // default using [] if initial value is omited
    async append(key, value, { initialValue = [], ttl }) {
        if (this.options.useMemCache) {
            if (typeof this.cache[key] === 'undefined') {
                let newValue = null;
                if (Array.isArray(initialValue)) {
                    newValue = [];
                    Array.prototype.push.apply(newValue, initialValue);
                    newValue.push(value);
                } else if (typeof initialValue === 'object' && typeof value === 'object') {
                    newValue = {};
                    Object.assign(newValue, initialValue, value);
                }
                this.cache[key] = newValue;
                const self = this;
                // const 
                // setTimeout(async() => {

                // });
            }
        }
    }
}

module.exports = CacheInFile;
