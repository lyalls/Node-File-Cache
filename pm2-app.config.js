module.exports = {
    apps: [
        {
            name: 'debug',
            script: './debug/multiThread.js',
            env: {
                NODE_ENV: 'development',
                NODE_DEBUG: 'node-file-mem-cache',
            },
            instances: 0,
            // exec_mode: 'cluster',
        },
    ],
};
