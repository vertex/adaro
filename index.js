'use strict';

// XXX - 'dustjs-helpers' has a side-effect of loading and returning dustjs-linkedin
var fs = require('fs'),
    path = require('path'),
    assert = require('assert'),
    dust = requireAny('dustjs-helpers', 'dustjs-linkedin');


var LEADING_SEPARATOR = new RegExp('^[\\' + path.sep + ']?', '');
var MY_SPECIAL_FRIEND = '$|_-^-_|$';


function requireAny(/*modules*/) {
    var result, failed;

    result = undefined;
    failed = [];

    Array.prototype.slice.call(arguments).some(function (moduleName) {
        try {
            result = require(moduleName);
        } catch (err) {
            // noop
            failed.push(moduleName);
        }
        return !!result;
    });

    assert.ok(failed.length !== arguments.length, 'Required module(s) not found. Please install one of the following: ' + failed.join(', '));
    return result;
}


function loadHelper(helper) {
    // Should be a dependency of the parent app
    var fn = require(helper);
    if (typeof fn === 'function' && fn.length === 1) {
        // Handle API that returns an initialization function. Otherwise, assume
        // it conforms to the same pattern as dustjs-helpers.
        fn(dust);
    }
}


function readFile(file, options, callback) {
    if (dust.onLoad) {
        dust.onLoad(file, callback);
        return;
    }
    fs.readFile(file, 'utf8', callback);
}


function isAbsolutePath(file) {
    return path.resolve(file, file) === file;
}


function createRenderer(config, doRead) {
    var ext, views, nameify;

    config = config || {};
    config.helpers && config.helpers.forEach(loadHelper);
    config.cache = (config.cache === undefined) ? true : !!config.cache;

    dust.load = (typeof dust.__cabbage__ === 'function') ? dust.__cabbage__ : dust.load;
    ext = null;
    views = null;
    nameify = null;


    return function (file, options, callback) {

        // Patching Rules
        // onLoad read
        //   -     -    patch and use default fs `read` only for express render
        //   X     -    Leave default behavior
        //   -     X    patch and use `read` only for express render
        //   X     X    patch and use `read` only for express render

        if (dust.load.name !== 'cabbage') {
            ext = path.extname(file);
            views = '.';

            if (options) {
                ext   = (options.ext && ('.' + options.ext)) || ext;
                views = options.views || (options.settings && options.settings.views) || views;
            }

            nameify = function (file) {
                var name = file;
                name = name.replace(views, ''); // Remove absolute path (if necessary)
                name = name.replace(ext, '');   // Remove file extension
                name = name.replace(LEADING_SEPARATOR, ''); // Remove leading slash (platform-dependent, if necessary)
                name = name.replace(path.sep, '/'); // Ensure path separators in name are all forward-slashes.
                return name;
            };

            // CABBAGE PATCH - Here comes the fun...
            // In order to provide request context to our `read` method we need to get creative with dust.
            // We don't to overwrite load, but we do want to use its conventions against it.
            dust.__cabbage__ = dust.load;
            dust.load = function cabbage(name, chunk, context) {
                var head = context.stack.head;

                // Only use patch only for express rendering (existence of `views` or `settings.views`)
                if (!(head.views || (head.settings && head.settings.views))) {
                    return dust.__cabbage__.apply(undefined, arguments);
                }

                // We exploit the cache to hook into load/onLoad behavior. Dust first checks the cache before
                // trying to load (dust.cache[name]), so if we add a custom getter and give it a custom key name
                // we can get dust to call our code.
                dust.cache.__defineGetter__(MY_SPECIAL_FRIEND, function () {
                    // Remove the getter immediately
                    delete dust.cache[MY_SPECIAL_FRIEND];

                    return function (chunk, context) {
                        var file = name;

                        if (!path.extname(file)) {
                            file += ext;
                        }

                        if (!isAbsolutePath(file)) {
                            file = path.join(views, file);
                        }

                        // Emulate what dust does when onLoad is called.
                        return chunk.map(function (chunk) {
                            // Always provide the head to read in this context.
                            doRead(file, nameify(file), context.stack.head, function (err, src) {
                                if (typeof src !== 'function') {
                                    src = dust.loadSource(dust.compile(src));
                                }
                                delete dust.cache[name];
                                src(chunk, context).end();
                            });
                        });
                    }
                });

                return dust.__cabbage__(MY_SPECIAL_FRIEND, chunk, context);
            };
        }

        dust.render(nameify(file), options, function () {
            if (!config.cache) {
                dust.cache = {};
            }
            callback.apply(undefined, arguments);
        });
    }
}


exports.js = function (config) {
    var read = readFile;
    if (config && (typeof config.read === 'function')) {
        read = config.read;
        config.cache = false;
    }

    function doRead(path, name, options, callback) {
        read(path, options, function (err, data) {
            if (err) {
                callback(err);
                return;
            }
            // Put directly into cache so it's available when dust.onLoad returns.
            dust.loadSource(data);
            callback(null, dust.cache[name]);
        });
    }

    return createRenderer(config, doRead);
};


exports.dust = function (config) {
    var read = readFile;
    if (config && (typeof config.read === 'function')) {
        read = config.read;
        config.cache = false;
    }

    function doRead(path, name, options, callback) {
        read(path, options, callback);
    }

    return createRenderer(config, doRead);
};


exports.compile = dust.compile;


exports.compileFn = dust.compileFn;

