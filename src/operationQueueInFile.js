/**
 * Created by Lyall, 14/9/2017
 */

const FS = require('fs');
const PATH = require('path');
const { debuglog, mkdir } = require('./utils');

const parseProcQueueItem = (itemName) => {
    if (!itemName) return { timestamp: NaN, processTag: '' };
    return {
        timestamp: Number(itemName.substr(0, itemName.indexOf('-'))),
        processTag: itemName.substr(itemName.indexOf('-') + 1),
    };
};

class OperationQueueInFile {
    constructor(options) {
        this.options = Object.assign({
            workdir: PATH.join(process.cwd(), 'tmp'),
            processTag: `${Date.now()}.${process.pid}`,
            heartbeatTimeout: 3000, // In milliseconds
        }, options);
        this.options.procHeartDir = PATH.join(this.options.workdir, 'proc');
        this.options.procQueueDir = PATH.join(this.options.workdir, 'queue');
        this.options.dataDir = PATH.join(this.options.workdir, 'data');
        this.options.heartbeatPath = PATH.join(this.options.procHeartDir, this.options.processTag);
        this.options.heartbeatInterval = Math.round(this.options.heartbeatTimeout / 3);

        this.heartbeatInstance = null;
        this.queue = [];

        // Create the work area
        [
            this.options.workdir,
            this.options.procHeartDir,
            this.options.procQueueDir,
        ].forEach(dir => mkdir(dir));
    }

    get processTag() {
        return this.options.processTag;
    }

    async init() {
        // Initialize file cache
        const self = this;
        return new Promise((resolve, reject) => {
            try {
                // Start heartbeat
                self.heartbeat();
                // Start the watcher of operation queue
                FS.watch(self.options.procQueueDir, self.queuedirHandler.bind(self));
            } catch (e) {
                reject(e);
            }
            // Make sure other processes can finish initiation
            setTimeout(() => {
                resolve(self.processTag);
            }, self.options.heartbeatTimeout);
        });
    }

    // Operation queue handlers
    queuedirHandler(/* type, filename */) {
        // const item = parseProcQueueItem(filename);
        this.processJobQueue({ fromNotification: true });
    }

    processJobQueue({ fromNotification = false }) {
        // 
        // No matter what kind of job
        // The process must queue itself to get control of the storage
        // If there is no other processes alive, then no need to wait
        // If Write a message into the process queue

        // Enqueue the process
        let processQueueFile = null;
        if (!fromNotification) {
            processQueueFile = PATH.join(this.options.procQueueDir, `${Date.now()}-${this.options.processTag}`);
            FS.writeFileSync(processQueueFile, '1');
        }
        // Read the queue to check whether current process is at the top
        const procQueue = FS.readdirSync(this.options.procQueueDir);
        if (procQueue.length > 0) {
            let top = 0;
            let min = -1;
            // No need to sort, the top one item is ok
            for (let i = 0; i < procQueue.length; i++) {
                procQueue[i] = parseProcQueueItem(procQueue[i]);
                if (min < 0 || procQueue[i].timestamp < min) {
                    min = procQueue[i].timestamp;
                    top = i;
                }
            }
            const topProc = procQueue[top];
            if (topProc.processTag === this.options.processTag) {
                processQueueFile = PATH.join(
                    this.options.procQueueDir,
                    `${topProc.timestamp}-${topProc.processTag}`,
                );
                // The current process is at the top of the queue
                const removeQueueFile = () => {
                    try {
                        FS.unlinkSync(processQueueFile);
                    } catch (e) {
                        debuglog(
                            'Error when removing queue item from process queue dir:',
                            processQueueFile,
                            e,
                        );
                    }
                };
                if (this.queue.length > 0) {
                    // Process the job
                    const cb = this.dequeue();
                    cb();
                }
                removeQueueFile();
            }
        }
    }

    // Clear dead/illegal process
    healthCheck() {
        try {
            const procs = FS.readdirSync(this.options.procHeartDir);
            const self = this;
            const aliveprocs = {};
            if (Array.isArray(procs) && procs.length > 0) {
                procs.forEach((processTag) => {
                    const procheart = PATH.join(self.options.procHeartDir, processTag);
                    try {
                        const timestamp = Number(FS.readFileSync(procheart));
                        if (Date.now() - timestamp < self.options.heartbeatTimeout) {
                            aliveprocs[processTag] = timestamp;
                        } else {
                            // Clear dead process heart
                            FS.unlinkSync(procheart);
                        }
                    } catch (e) {
                        if (FS.existsSync(procheart)) {
                            throw e;
                        }
                    }
                });
            }
            // Clear dead/illegal processes from the queue
            const queue = FS.readdirSync(this.options.procQueueDir);
            if (Array.isArray(queue) && queue.length > 0) {
                queue.forEach((job) => {
                    const filepath = PATH.join(self.options.procQueueDir, job);
                    try {
                        const processTag = job.split('-')[1];
                        if (!aliveprocs[processTag]) {
                            FS.unlinkSync(filepath);
                        }
                    } catch (e) {
                        if (FS.existsSync(filepath)) {
                            throw e;
                        }
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
                const self = this;
                process.on('exit', () => {
                    clearInterval(self.heartbeatInstance);
                });
            }
        } catch (e) {
            debuglog('Error when heartbeating', e);
        }
        return this.heartbeatInstance;
    }

    // File cache queue operations
    enqueue(callback) {
        if (typeof callback !== 'function') return false;
        this.queue.push(callback);
        this.processJobQueue({ fromNotification: false });
        return true;
    }

    dequeue() {
        return this.queue.shift();
    }
}

module.exports = OperationQueueInFile;
