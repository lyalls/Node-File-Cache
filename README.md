# Node-Cache-In-File
Cache for Node.js used in multi-process scenario, which store data in files

Quick start
-----------
```javascript
const { CacheInFile } = require('node-cache-in-file');
const cache = new CacheInFile();

const asyncQuery = (key, timeout) => {
    return new Promise((resolve, reject) => {
        setTimeout(async () => {
            try {
                const value = await cache.get(key);
                resolve(value);
            } catch (e) {
                reject(e);
            }
        }, timeout);
    })
}

cache.set('Hello', 'world', 1000)
    .then(() => {
        return asyncQuery('Hello', 300);
    })
    .then((value) => {
        console.log('Value still alive:', value);
        return asyncQuery('Hello', 1000);
    })
    .then((value) => {
        console.log('Value not alive:', value);
    })
    .catch((error) => {
        console.log('ERROR', error);
    })
```

Capabilities
------------
1. Share data accross multi-processes using file system
1. Guarantee the consistency of data
1. Guarantee NO hungry in the competition
1. No need to aware the existence of other processes

Backfires
---------
1. High latency in heavy throughput or competition scenario 

Interfaces
----------
### cache.get(key)
Get the value of `key`

### cache.set(key, value[, ttl])
Set value for `key`
ttl: time to live, number in milliseconds, omit or 0 or -1 for max ttl

### cache.reset(key)
Delete `key`

### cache.keys()
Return an array contain all `keys`

### cache.append(key, value[, { initialValue = [], ttl }])
Append the value at the end of an array, or add a pair of property and value for an object.
Using `initialValue` to indicate the original type, `initialValue` will be used as the initial array or object, when the `key` does not exist

### cache.remove(key, item[, { type = 'index', match = 'first', length = 1 }])
Remove an item from an array, or a property of an object
When the target of the `key` is an array, the item could be an element of the array, or an index to indicate the location of the element, depends on the value of `type`, which could be `index` or `item`
When the `type` value is `index`, `item` and `length` are used as the parameters of `Array.splice(index, length)`;
When the `type` value is `item`, `match` indicate the match mode. If the match mode is `first`, it will remove the first element which match the value of `item`; if is `all`, it will remove all the matched elements.

# LICENSE
### MIT
### PLUS: Buy the author a bottle of beer in the nearest bar if you meet him

Enjoy!
