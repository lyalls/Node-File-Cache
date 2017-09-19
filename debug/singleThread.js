const { CacheInFile } = require('../src/index.js');
// Create a Cache
const cache = new CacheInFile({
    useFileCache: true,
});

const now = Date.now();

cache.init()
    .then(async (inited) => {
        console.log('inited:', inited);
        return new Promise(async (resolve, reject) => {
            const response = await cache.set('hello', {
                date: now,
                name: 'world',
            }, 1000);
            console.log('set response:', response);
            setTimeout(async () => {
                try {
                    const res = await cache.get('hello');
                    resolve(res);
                } catch (e) {
                    reject(e);
                }
            }, 500);
        });
    })
    .then((response) => {
        console.log('get response in 500ms:', response);
        return new Promise(async (resolve, reject) => {
            setTimeout(async () => {
                try {
                    const res = await cache.get('hello');
                    resolve(res);
                } catch (e) {
                    reject(e);
                }
            }, 600);
        });
    })
    .then((response) => {
        console.log('get response in 1100ms:', response);
    })
    .catch((e) => {
        console.log('ERROR:', e);
    });
