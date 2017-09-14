/**
 * Created by Lyall, 14/9/2017
 */

const FS = require('fs');
const PATH = require('path');
const UTIL = require('util');
const { packageName } = require('../package.json');

const DL = UTIL.debuglog(packageName);
const debuglog = (...params) => {
    DL(`[${packageName}]`, ...params);
};

const mkdir = (dirpath) => {
    if (!dirpath || typeof dirpath !== 'string') return;
    let path = '/';
    dirpath.split('/').forEach((dir) => {
        path = PATH.join(path, dir);
        if (!FS.existsSync(path)) {
            try {
                FS.mkdirSync(path);
            } catch (e) {
                debuglog(`Error when creating workdir [${path}]`, e);
            }
        }
    });
};

class Cache {
    constructor(options) {
        this.options = Object.assign({
            useFileCache: false,
            useMemCache: true,
            workdir: PATH.join(process.cwd(), 'tmp/cache'),
            processTag: `${Date.now()}.${process.pid}`,
            heartbeatTimeout: 1000, // In milliseconds
        }, options);
        this.options.procDir = PATH.join(this.options.workdir, 'proc');
        this.options.queueDir = PATH.join(this.options.workdir, 'queue');
        this.options.heartbeatPath = PATH.join(this.options.procDir, this.options.processTag);
        this.options.heartbeatInterval = Math.round(this.options.heartbeatTimeout / 3);

        this.initialized = false;
        this.heartbeatInstance = null;
        this.queue = null;
        this.cache = {};
    }

    async init() {
        // Initialize file cache
        const self = this;
        return new Promise((resolve) => {
            if (self.options.useFileCache) {
                self.queue = [];
                // Create the file cache work area
                [
                    self.options.workdir,
                    self.options.procDir,
                    self.options.queueDir,
                ].forEach(dir => mkdir(dir));
                // Start heartbeat
                self.heartbeat();
                setTimeout(() => {
                    resolve(true);
                }, self.options.heartbeatTimeout);
                // Clear illegal cache files
            } else {
                resolve(true);
            }
        });
    }

    // Clear dead/illegal process
    healthCheck() {
        try {
            const procs = FS.readdirSync(this.options.procDir);
            const aliveprocs = {};
            if (Array.isArray(procs) && procs.length > 0) {
                const self = this;
                procs.forEach((procTag) => {
                    const procheart = PATH.join(self.options.procDir, procTag);
                    const timestamp = Number(FS.readFileSync(procheart));
                    if (Date.now() - timestamp < self.options.heartbeatTimeout) {
                        aliveprocs[procTag] = timestamp;
                    } else {
                        // Clear dead process heart
                        FS.unlinkSync(procheart);
                    }
                });
            }
            // Clear dead/illegal processes from the queue
            const queue = FS.readdirSync(this.options.queueDir);
            if (Array.isArray(queue) && queue.length > 0) {
                const self = this;
                queue.forEach((job) => {
                    const procTag = job.split('-')[1];
                    if (!aliveprocs[procTag]) {
                        FS.unlinkSync(PATH.join(self.options.queueDir, job));
                    }
                });
            }
        } catch (e) {
            debuglog('Error when checking health', e);
        }
    }

    // To indicate this process is still alive
    // And clear the dead/illegal process out from the queue
    heartbeat() {
        try {
            FS.writeFileSync(this.options.heartbeatPath, Date.now());
            this.healthCheck();
            if (!this.heartbeatInstance) {
                this.heartbeatInstance = setInterval(
                    this.heartbeat.bind(this),
                    this.options.heartbeatInterval,
                );
            }
        } catch (e) {
            debuglog('Error when heartbeating', e);
        }
        return this.heartbeatInstance;
    }

    // File cache queue operations
    enqueue(job) {
        this.queue.push(job);
    }

    dequeue() {
        this.queue.shift();
    }

    // Cache interfaces
    async get(key) {
        if (this.useMemCache && typeof this.cache[key] !== 'undefined') {
            return this.cache[key];
        } else if (this.useFileCache) {
            const self = this;
            return new Promise((resolve, reject) => {
                const job = {
                    type: 'GET',
                    key,
                    arriveAt: Date.now(),
                    callback: (error, data) => {
                        if (error) reject(error);
                        else resolve(data);
                    },
                };
                self.enqueue(job);
            });
        }
        return null;
    }

    async set(key, value, ttl) {
        if (this.useFileCache) {
            const self = this;
            return new Promise((resolve, reject) => {
                const job = {
                    type: 'SET',
                    key,
                    value,
                    ttl,
                    arriveAt: Date.now(),
                    callback: (error, feedback) => {
                        if (error) reject(error);
                        else {
                            if (self.useMemCache) {
                                self.cache[key] = value;
                            }
                            if (typeof ttl === 'number' && ttl > 0) {
                                setTimeout(async () => {
                                    await self.reset(key);
                                }, ttl);
                            }
                            resolve(feedback);
                        }
                    },
                };
                self.enqueue(job);
            });
        } else if (this.useMemCache) {
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
        if (this.useMemCache && typeof this.cache[key] !== 'undefined') {
            delete this.cache[key];
        }

        if (this.useFileCache) {
            const self = this;
            return new Promise((resolve, reject) => {
                const job = {
                    type: 'RESET',
                    key,
                    arriveAt: Date.now(),
                    callback: (error, feedback) => {
                        if (error) reject(error);
                        else resolve(feedback);
                    },
                };
                self.enqueue(job);
            });
        }

        return true;
    }
}
