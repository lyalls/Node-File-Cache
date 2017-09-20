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
            num: Math.round(Math.random() * 1000),
            arriveAt: now,
        }, -1);
        const t2 = Date.now();
        const data = await cache.get(key);
        const t3 = Date.now();
        console.log(`[${process.pid}] Time spent for setting: ${t2 - t1}, for getting: ${t3 - t2}`);
        console.log(`[${process.pid}] content:`, data);
        // Cross processes
        let processes = await cache.append('PROCESSES_LIST', process.pid);
        const t4 = Date.now();
        console.log(`[${process.pid}] Time spent for append: ${t4 - t3}, processes:`, processes);
        // setTimeout(async () => {
        //     const t5 = Date.now();
        //     const proclist = await cache.get('PROCESSES_LIST');
        //     const t6 = Date.now();
        //     console.log(`[${process.pid}] Time spent for reading common key: ${t6 - t5}, processes:`, proclist);
        // }, 2000);
        const appendValue = {};
        appendValue[process.pid] = key;
        processes = await cache.append('PROCESSES_KEYS', appendValue, { initialValue: {} });
        const t7 = Date.now();
        console.log(`[${process.pid}] Time spent for append key in object: ${t7 - t4}, processes:`, processes);
        // const keys = await cache.keys();
        // const t8 = Date.now();
        // console.log(`[${process.pid}] Time spent for keys: ${t8 - t7}, keys:`, keys);
        // processes = await cache.remove('PROCESSES_KEYS', process.pid);
        // const t9 = Date.now();
        // console.log(`[${process.pid}] Time spent for remove key: ${t9 - t8}, processes:`, processes);
    })
    .catch((e) => {
        console.log(`[${process.pid}] ERROR:`, e);
    });
