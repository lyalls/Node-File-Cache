/**
 * Created by Lyall, 19/9/2017
 */

const FS = require('fs');
const PATH = require('path');
const UTIL = require('util');
const { name } = require('../package.json');

exports.packageName = name;

const DL = UTIL.debuglog(name);
const debuglog = (...params) => {
    DL(`[${new Date()}]`, ...params);
};
exports.debuglog = debuglog;

exports.mkdir = (dirpath) => {
    if (!dirpath || typeof dirpath !== 'string') return;
    let path = '/';
    dirpath.split('/').forEach((dir) => {
        path = PATH.join(path, dir);
        try {
            if (!FS.existsSync(path)) {
                FS.mkdirSync(path);
            }
        } catch (e) {
            debuglog(`Error when creating dir [${path}]`, e);
        }
    });
};
