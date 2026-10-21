/* Copyright © 2026 Zolvat Ltd */
/*jshint esversion:6 */
'use strict';

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

function runTests() {
  var projectRoot = path.resolve(__dirname, '../..');
  var project = require('../../package.json');
  var npmCli = path.join(projectRoot, 'node_modules/npm/bin/npm-cli.js');
  var npmVersion = require(path.join(projectRoot, 'node_modules/npm/package.json')).version;
  assert.strictEqual('npm@' + npmVersion, project.packageManager);
  assert.deepStrictEqual(project.allowScripts, {});

  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'npm script policy '));
  var userConfig = path.join(temporary, 'user.npmrc');
  var globalConfig = path.join(temporary, 'global.npmrc');
  var npmrc = fs.readFileSync(path.join(projectRoot, '.npmrc'), 'utf8');
  // Isolate only child npm configuration; never change the caller's environment.
  var environment = {};
  Object.keys(process.env).forEach(function(key) {
    if (!/^npm_config_/i.test(key)) {
      environment[key] = process.env[key];
    }
  });

  function npm(args, cwd) {
    return childProcess.spawnSync(process.execPath, [npmCli].concat(args, [
      '--offline', '--no-audit', '--no-fund',
      '--userconfig', userConfig, '--globalconfig', globalConfig
    ]), { cwd: cwd, env: environment, encoding: 'utf8', timeout: 15000 });
  }

  function fixture(name, approval) {
    var directory = path.join(temporary, name);
    fs.mkdirSync(directory);
    var policy = Object.assign({}, project.allowScripts);
    if (typeof approval === 'boolean') {
      policy['file:../install-hook-fixture-1.0.0.tgz'] = approval;
    }
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      name: 'policy-' + name,
      version: '1.0.0',
      allowScripts: policy,
      dependencies: {
        'install-hook-fixture': 'file:../install-hook-fixture-1.0.0.tgz'
      }
    }));
    fs.writeFileSync(path.join(directory, '.npmrc'), npmrc);
    return directory;
  }

  function marker(directory) {
    return path.join(directory, 'node_modules/install-hook-fixture/script-ran');
  }

  try {
    fs.writeFileSync(userConfig, '');
    fs.writeFileSync(globalConfig, '');
    var dependency = path.join(temporary, 'dependency');
    fs.mkdirSync(dependency);
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({
      name: 'install-hook-fixture',
      version: '1.0.0',
      scripts: { postinstall: 'node hook.js' }
    }));
    fs.writeFileSync(path.join(dependency, 'hook.js'),
      'require("fs").writeFileSync("script-ran", "executed");\n');
    var packed = npm(['pack', '--json', '--pack-destination', temporary], dependency);
    assert.strictEqual(packed.status, 0, packed.stderr);
    assert.strictEqual(JSON.parse(packed.stdout)['install-hook-fixture'].filename,
      'install-hook-fixture-1.0.0.tgz');

    var unreviewed = fixture('unreviewed');
    var blocked = npm(['install'], unreviewed);
    assert.notStrictEqual(blocked.status, 0, blocked.stdout);
    assert.match(blocked.stderr, /ESTRICTALLOWSCRIPTS/);
    assert.strictEqual(fs.existsSync(marker(unreviewed)), false);
    console.log('Unreviewed install script: rejected without execution.');

    var approved = fixture('approved', true);
    var allowed = npm(['install'], approved);
    assert.strictEqual(allowed.status, 0, allowed.stderr);
    assert.strictEqual(fs.readFileSync(marker(approved), 'utf8'), 'executed');
    console.log('Explicitly approved local tarball script: executed.');

    var denied = fixture('denied', false);
    var skipped = npm(['install'], denied);
    assert.strictEqual(skipped.status, 0, skipped.stderr);
    assert.strictEqual(fs.existsSync(marker(denied)), false);
    console.log('Explicitly denied install script: skipped.');

    var unknownConfig = fixture('unknown-config', false);
    fs.appendFileSync(path.join(unknownConfig, '.npmrc'), 'unrecognized-policy-setting=true\n');
    var invalidConfig = npm(['install'], unknownConfig);
    assert.notStrictEqual(invalidConfig.status, 0);
    assert.match(invalidConfig.stderr, /unrecognized-policy-setting/);
    assert.strictEqual(fs.existsSync(marker(unknownConfig)), false);

    var invalidFlag = npm(['install', '--unrecognized-policy-flag'], approved);
    assert.notStrictEqual(invalidFlag.status, 0);
    assert.match(invalidFlag.stderr, /unrecognized-policy-flag/);
    console.log('Unknown npmrc setting and CLI flag: rejected.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runTests();
}
