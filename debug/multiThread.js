const { CacheInFile } = require('../src/index.js');

const cache = new CacheInFile({
    useFileCache: true,
});

const now = Date.now();

cache.init()
    .then(async () => {
        // Basic tests
        const key = `key/${process.pid}`;
        const t1 = Date.now();
        await cache.set(key, {
            pid: process.pid,
            arriveAt: now,
        }, -1);
        const t2 = Date.now();
        const data = await cache.get(key);
        const t3 = Date.now();
        console.log(`[${process.pid}] Time spent for setting: ${t2 - t1}, for getting: ${t3 - t2}`);
        console.log(`[${process.pid}] content:`, data);
    })
    .catch((e) => {
        console.log(`[${process.pid}] ERROR:`, e);
    });
