var test = require('tape');
var path = require('path');
var fs = require('fs');
var exec = require('child_process').exec;
var zipfile = require('zipfile');

var example = path.resolve(__dirname, '..', 'streambot-example');
var bundle = path.resolve(__dirname, '..', 'bin', 'bundle');

// prep by installing npm modules
test('[bundle] npm install', function(assert) {
  exec('npm install', { cwd: example }, function(err, stdout, stderr) {
    if (err) {
      console.log(stdout);
      console.log(stderr);
      throw err;
    }

    assert.end();
  });
});

test('[bundle] add .git folder', function(assert) {
  var git = path.join(example, '.git');
  fs.mkdir(git, function(err) {
    if (err && err.code !== 'EEXIST') throw err;
    fs.writeFile(path.join(git, 'should-not-bundle'), 'nope', function(err) {
      if (err) throw err;
      assert.end();
    });
  });
});

test('[bundle] bundle', function(assert) {
  exec([bundle, example].join(' '), function(err, stdout, stderr) {
    assert.ifError(err, 'bundled');

    if (err) {
      console.log(stdout);
      console.log(stderr);
    }

    var outFile = stdout.trim();
    assert.ok(fs.existsSync(outFile), 'creates zipfile');
    var zf = new zipfile.ZipFile(outFile);
    var filenames = zf.names;

    assert.ok(filenames.indexOf('index.js') > -1, 'contains index.js');
    assert.ok(filenames.indexOf('package.json') > -1, 'contains package.json');
    assert.ok(filenames.indexOf('node_modules/streambot/index.js') > -1, 'contains node_modules/streambot/index.js');
    assert.ok(filenames.indexOf('node_modules/srs/lib/binding/node-v11-linux-x64/srs.node') > -1, 'contains node_modules/srs/lib/binding/node-v11-linux-x64/srs.node');
    assert.ok(filenames.indexOf('node_modules/tape/index.js') < 0, 'does not contain node_modules/tape/index.js');
    assert.ok(filenames.indexOf('.git/should-not-bundle') < 0, 'does not bundle .git folders');

    assert.end();
  });
});

test('[bundle] back to normal', function(assert) {
  var binding = path.join(
    example,
    'node_modules',
    'srs',
    'lib',
    'binding'
  );

  var dir = fs.readdirSync(binding)[0];
  var re = new RegExp(process.platform + '-' + process.arch);
  assert.ok(re.test(dir), 'folder for platform/arch');
  assert.ok(fs.readdirSync(path.join(binding, dir)).indexOf('srs.node') > -1, 'found srs.node');

  var expected = path.join(
    example,
    'node_modules',
    'tape',
    'index.js'
  );

  assert.ok(fs.existsSync(expected), 'devDependencies reinstalled');

  assert.end();
});
