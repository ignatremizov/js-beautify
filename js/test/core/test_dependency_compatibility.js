/* Copyright © 2026 Zolvat Ltd */
/*jshint mocha:true, esversion:6 */
'use strict';

var assert = require('assert');
var execFileSync = require('child_process').execFileSync;
var http = require('http');
var path = require('path');
var zlib = require('zlib');
var compression = require('compression');
var handler = require('serve-handler');

describe('JSHint dependencies', function() {
  it('matches ignored fixture paths with Windows separators', function() {
    var matcherPath = require.resolve('minimatch', {
      paths: [path.dirname(require.resolve('jshint/package.json'))]
    });
    // Load the actual dependency in an isolated process with Windows path semantics.
    execFileSync(process.execPath, ['-e', [
      "var assert = require('assert');",
      "require('path').sep = '\\\\';",
      "var matcher = require(process.argv[1]);",
      "assert.strictEqual(typeof matcher, 'function');",
      "assert.ok(matcher('C:\\\\repo\\\\test\\\\resources\\\\underscore.js',",
      "  'C:\\\\repo\\\\test\\\\resources/*', { nocase: true, dot: true }));"
    ].join('\n'), matcherPath], { stdio: 'pipe' });
  });
});

describe('Development server dependencies', function() {
  it('serves matching custom headers and compressed content', function(done) {
    var serverError;
    var server = http.createServer(function(request, response) {
      compression({ threshold: 0 })(request, response, function() {
        Promise.resolve(handler(request, response, {
          public: path.resolve(__dirname, '../resources'),
          headers: [{
            source: '**/*.js',
            headers: [{ key: 'X-Beautify-Test', value: 'matched' }]
          }]
        })).catch(function(error) {
          serverError = error;
          response.destroy(error);
        });
      });
    });

    server.listen(0, '127.0.0.1', function() {
      var request = http.get({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: '/example1.js',
        headers: { 'Accept-Encoding': 'gzip' }
      }, function(response) {
        var chunks = [];
        response.on('data', function(chunk) { chunks.push(chunk); });
        response.on('end', function() {
          server.close(function() {
            try {
              assert.strictEqual(response.statusCode, 200);
              assert.strictEqual(response.headers['x-beautify-test'], 'matched');
              assert.strictEqual(response.headers['content-encoding'], 'gzip');
              assert.ok(zlib.gunzipSync(Buffer.concat(chunks)).length > 0);
              done();
            } catch (error) {
              done(error);
            }
          });
        });
      });
      request.on('error', function(error) {
        server.close(function() { done(serverError || error); });
      });
    });
  });
});
