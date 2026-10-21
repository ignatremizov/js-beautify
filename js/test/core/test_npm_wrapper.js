/* Copyright © 2026 Zolvat Ltd */
/*jshint mocha:true, esversion:6 */
'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var projectRoot = path.resolve(__dirname, '../../..');
var npmPackage = require('../../../package.json').packageManager;
var npmVersion = npmPackage.slice('npm@'.length);

describe('Pinned npm wrapper', function() {
  var fixture;
  var environment;

  function cacheVersion(version) {
    fs.mkdirSync(path.join(fixture, 'node_modules/npm'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'node_modules/npm/package.json'),
      JSON.stringify({ version: version }));
    fs.copyFileSync(path.join(fixture, 'local-npm'),
      path.join(fixture, 'node_modules/.bin/npm'));
  }

  function run(args, extraEnvironment) {
    return childProcess.spawnSync('bash', [path.join(fixture, 'tools/npm')].concat(args), {
      cwd: path.join(fixture, 'caller directory'),
      env: Object.assign({}, environment, extraEnvironment),
      encoding: 'utf8',
      timeout: 5000
    });
  }

  function installs() {
    var log = path.join(fixture, 'installs.jsonl');
    return fs.existsSync(log) ?
      fs.readFileSync(log, 'utf8').trim().split('\n').map(function(line) {
        var args = JSON.parse(line);
        // Git Bash supplies forward slashes on Windows; compare the same native path.
        args[3] = path.normalize(args[3]);
        return args;
      }) : [];
  }

  beforeEach(function() {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'npm wrapper '));
    ['tools', 'fake-bin', 'caller directory'].forEach(function(directory) {
      fs.mkdirSync(path.join(fixture, directory));
    });
    fs.copyFileSync(path.join(projectRoot, 'tools/npm'), path.join(fixture, 'tools/npm'));
    fs.writeFileSync(path.join(fixture, 'package.json'),
      JSON.stringify({ packageManager: npmPackage }));
    fs.writeFileSync(path.join(fixture, 'local-npm'),
      '#!/usr/bin/env bash\nexec node "$NPM_WRAPPER_FIXTURE_DRIVER" run "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(fixture, 'fake-bin/npm'),
      '#!/usr/bin/env bash\nexec node "$NPM_WRAPPER_FIXTURE_DRIVER" install "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(fixture, 'driver.js'), [
      'var fs = require("fs"), path = require("path");',
      'var root = process.env.NPM_WRAPPER_FIXTURE_ROOT;',
      'var args = process.argv.slice(3);',
      'if (process.argv[2] === "install") {',
      '  fs.appendFileSync(path.join(root, "installs.jsonl"), JSON.stringify(args) + "\\n");',
      '  if (process.env.NPM_WRAPPER_INSTALL_EXIT) process.exit(Number(process.env.NPM_WRAPPER_INSTALL_EXIT));',
      '  fs.mkdirSync(path.join(root, "node_modules/npm"), {recursive:true});',
      '  fs.mkdirSync(path.join(root, "node_modules/.bin"), {recursive:true});',
      '  fs.writeFileSync(path.join(root, "node_modules/npm/package.json"), JSON.stringify({version:args[1].slice(4)}));',
      '  fs.copyFileSync(path.join(root, "local-npm"), path.join(root, "node_modules/.bin/npm"));',
      '} else {',
      '  process.stdout.write(JSON.stringify(args) + "\\n");',
      '  process.exit(Number(process.env.NPM_WRAPPER_COMMAND_EXIT || 0));',
      '}'
    ].join('\n'));
    environment = Object.assign({}, process.env, {
      PATH: path.join(fixture, 'fake-bin') + path.delimiter + process.env.PATH,
      NPM_WRAPPER_FIXTURE_ROOT: fixture,
      NPM_WRAPPER_FIXTURE_DRIVER: path.join(fixture, 'driver.js')
    });
  });

  afterEach(function() {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  [null, '11.0.0', '12.0.0'].forEach(function(version) {
    it('installs the pin for an ordinary command with cached npm ' + (version || 'missing'), function() {
      if (version) {
        cacheVersion(version);
      }
      var result = run(['audit']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(installs(), [
        ['i', npmPackage, '--prefix', fixture, '--no-save']
      ]);
      assert.strictEqual(JSON.parse(fs.readFileSync(
        path.join(fixture, 'node_modules/npm/package.json'), 'utf8')).version, npmVersion);
    });
  });

  it('uses matching cached npm without reinstalling', function() {
    cacheVersion(npmVersion);
    var result = run(['audit']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(installs(), []);
  });

  it('repairs a cached binary with missing version metadata', function() {
    cacheVersion(npmVersion);
    fs.unlinkSync(path.join(fixture, 'node_modules/npm/package.json'));
    var result = run(['audit']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(installs().length, 1);
  });

  it('preserves argument boundaries including spaces and empty arguments', function() {
    cacheVersion(npmVersion);
    var args = ['exec', '--', 'argument with spaces', '', '--prefix', 'directory with spaces'];
    var result = run(args);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), args);
  });

  it('preserves command failure even when the caller has a lockfile', function() {
    cacheVersion(npmVersion);
    fs.writeFileSync(path.join(fixture, 'caller directory/package-lock.json'), '{}\n');
    var result = run(['audit'], { NPM_WRAPPER_COMMAND_EXIT: '7' });
    assert.strictEqual(result.status, 7, result.stderr);
    assert.deepStrictEqual(installs(), []);
  });

  it('preserves bootstrap failure and does not run stale cached npm', function() {
    cacheVersion('12.0.0');
    var result = run(['audit'], { NPM_WRAPPER_INSTALL_EXIT: '9' });
    assert.strictEqual(result.status, 9, result.stderr);
    assert.strictEqual(installs().length, 1);
    assert.ok(result.stdout.indexOf('["audit"]') === -1);
  });
});
