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

const parseProcQueueItem = (itemName) => {
    if (!itemName) return { timestamp: NaN, processTag: '' };
    return {
        timestamp: Number(itemName.substr(0, itemName.indexOf('-'))),
        processTag: itemName.substr(itemName.indexOf('-') + 1),
    };
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
        this.options.procHeartDir = PATH.join(this.options.workdir, 'proc');
        this.options.procQueueDir = PATH.join(this.options.workdir, 'queue');
        this.options.dataDir = PATH.join(this.options.workdir, 'data');
        this.options.heartbeatPath = PATH.join(this.options.procHeartDir, this.options.processTag);
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
                    self.options.procHeartDir,
                    self.options.procQueueDir,
                ].forEach(dir => mkdir(dir));
                // Start heartbeat
                self.heartbeat();
                // Start the watcher of operation queue
                FS.watch(self.options.procQueueDir, self.queuedirHandler.bind(self));
                // Make sure other processes can finish initiation
                setTimeout(() => {
                    resolve(true);
                }, self.options.heartbeatTimeout);
            } else {
                resolve(true);
            }
        });
    }

    // Operation queue handlers
    queuedirHandler(type, filename) {
        const item = parseProcQueueItem(filename);
        if (item.processTag !== this.processTag) {
            this.processJobQueue();
        }
    }

    processJobQueue({ isInitialization = false }) {
        // 
        // No matter what kind of job
        // The process must queue itself to get control of the storage
        // If there is no other processes alive, then no need to wait
        // If Write a message into the process queue
        if (isInitialization) {
            FS.writeFileSync(PATH.join(this.options.procQueueDir, `${Date.now()}-${this.options.processTag}`), '1');
        }
        // Read the queue to check whether current process is at the top
        const procQueue = FS.readdirSync(this.options.procQueueDir);
        if (procQueue.length > 1) {
            let top = 0;
            let min = -1;
            for (let i = 0; i < procQueue.length; i++) {
                procQueue[i] = parseProcQueueItem(procQueue[i]);
                if (min < 0 || procQueue[i].timestamp < min) {
                    min = procQueue[i].timestamp;
                    top = i;
                }
            }
            const topProc = procQueue[top];
            if (topProc.processTag === this.options.processTag) {
                // Process the job
                const job = this.dequeue();
                job.callback = (error, response) => {
                    // When the job finished, remove the process queue
                    try {
                        FS.unlinkSync(PATH.join(this.options.procQueueDir, `${topProc.timestamp}-${topProc.processTag}`));
                    } catch (e) {
                        debuglog(
                            'Error when removing queue item from process queue dir:',
                            PATH.join(this.options.procQueueDir, `${topProc.timestamp}-${topProc.processTag}`),
                            e,
                        );
                    }
                    // invoke the callback of the job
                    job.callback(error, response);
                };
                // TODO: Do the job
            } else {
                // TODO: Wait for the process queue notification
            }
        }
    }

    // Clear dead/illegal process
    healthCheck() {
        try {
            const procs = FS.readdirSync(this.options.procHeartDir);
            const aliveprocs = {};
            if (Array.isArray(procs) && procs.length > 0) {
                const self = this;
                procs.forEach((processTag) => {
                    const procheart = PATH.join(self.options.procHeartDir, processTag);
                    const timestamp = Number(FS.readFileSync(procheart));
                    if (Date.now() - timestamp < self.options.heartbeatTimeout) {
                        aliveprocs[processTag] = timestamp;
                    } else {
                        // Clear dead process heart
                        FS.unlinkSync(procheart);
                    }
                });
            }
            // Clear dead/illegal processes from the queue
            const queue = FS.readdirSync(this.options.procQueueDir);
            if (Array.isArray(queue) && queue.length > 0) {
                const self = this;
                queue.forEach((job) => {
                    const processTag = job.split('-')[1];
                    if (!aliveprocs[processTag]) {
                        FS.unlinkSync(PATH.join(self.options.procQueueDir, job));
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

    // File change handler


    // File cache queue operations
    enqueue(job) {
        this.queue.push(job);
        this.processJobQueue({ isInitialization: true });
    }

    dequeue() {
        return this.queue.shift();
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

module.exports = Cache;
