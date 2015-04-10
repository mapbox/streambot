var test = require('tape');
var stack = require('cfn-test')('streambot', 'us-east-1');
var path = require('path');
var fs = require('fs');
var exec = require('child_process').exec;
var AWS = require('aws-sdk');
var deploy = require('../bin/deploy');
var lib = require('..').deploy;

var example = path.resolve(__dirname, '..', 'streambot-example');
var template = path.join(example, 'streambot-example.template');
template = JSON.parse(fs.readFileSync(template, 'utf8'));

test('[deploy] copy template to S3', function(assert) {
  var s3 = new AWS.S3();
  s3.putObject({
    Bucket: 'cf-templates-mapbox-us-east-1',
    Key: 'streambot/testing.template',
    Body: fs.createReadStream(path.resolve(__dirname, '..', 'cloudformation', 'streambot.template'))
  }, function(err) {
    if (err) throw err;
    assert.end();
  });
});

stack.start(template);

test('[deploy] getStackOutputs', function(assert) {
  process.chdir(example);

  lib.getStackOutputs(stack.stackName, 'us-east-1', function(err, outputs) {
    assert.ifError(err, 'got stack outputs');

    var keys = Object.keys(outputs);
    assert.ok(keys.indexOf('KinesisStream') > -1, 'found KinesisStream output');
    assert.ok(keys.indexOf('LambdaExecutionRole') > -1, 'found LambdaExecutionRole output');
    assert.ok(keys.indexOf('LambdaExecutionRoleName') > -1, 'found LambdaExecutionRoleName output');
    assert.ok(keys.indexOf('KinesisAdminRole') > -1, 'found KinesisAdminRole output');
    assert.ok(keys.indexOf('MetricName') > -1, 'found MetricName output');
    assert.ok(keys.indexOf('StackRegion') > -1, 'found StackRegion output');
    assert.ok(keys.indexOf('LogBucket') > -1, 'found LogBucket output');
    assert.ok(keys.indexOf('LogPrefix') > -1, 'found LogPrefix output');
    assert.ok(keys.indexOf('StreambotStack') > -1, 'found StreambotStack output from service template');

    assert.end();
  });
});

test('[deploy] getStackParameters', function(assert) {
  process.chdir(example);

  lib.getStackParameters(stack.stackName, 'us-east-1', function(err, params) {
    assert.ifError(err, 'got stack parameters');
    assert.deepEqual(params, {});
    assert.end();
  });
});

test('[deploy] getStackResources', function(assert) {
  process.chdir(example);

  lib.getStackResources(stack.stackName, 'us-east-1', function(err, resources) {
    assert.ifError(err, 'got stack resources');

    var keys = Object.keys(resources);
    assert.ok(keys.indexOf('StreambotStack') > -1, 'found StreambotStack resource');
    assert.ok(keys.indexOf('LambdaPolicy') > -1, 'found LambdaPolicy resource');
    assert.end();
  });
});

test('[deploy] wrap', function(assert) {
  process.chdir(example);

  var env = {
    SomeVariable: 'some value',
    Another: 'variable'
  };

  if (fs.existsSync('.env')) fs.unlinkSync('.env');

  lib.wrap(env, function(err) {
    assert.ifError(err, 'wrapped');

    assert.ok(fs.existsSync('.env'), 'created .env');
    var dotenv = fs.readFileSync('.env', 'utf8');

    assert.equal(dotenv, 'SomeVariable=some value\nAnother=variable\n', 'correct .env file');

    assert.end();
  });
});

test('[deploy] npm install', function(assert) {
  process.chdir(example);

  exec('npm install', { cwd: example }, function(err, stdout, stderr) {
    if (err) {
      console.log(stdout);
      console.log(stderr);
      throw err;
    }

    assert.end();
  });
});

test('[deploy] bundle', function(assert) {
  process.chdir(example);

  var zip = path.join('build', 'bundle.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  lib.bundle(function(err) {
    assert.ifError(err, 'bundled');
    assert.ok(fs.existsSync(zip), 'created bundle');
    assert.end();
  });
});

test('[deploy] deployFunction', function(assert) {
  process.chdir(example);

  lib.getStackOutputs(stack.stackName, 'us-east-1', function(err, outputs) {
    if (err) throw err;

    lib.deployFunction(
      'us-east-1',
      stack.stackName,
      path.resolve(__dirname, 'fixtures', 'bundle.zip'),
      'index.js',
      outputs.LambdaExecutionRole,
      'test function',
      uploaded
    );

    function uploaded(err, arn) {
      assert.ifError(err, 'uploaded function');

      var lambda = new AWS.Lambda({ region: 'us-east-1' });
      lambda.listFunctions({}, function(err, data) {
        if (err) throw err;

        var fn = data.Functions.filter(function(fn) {
          return fn.FunctionArn === arn;
        })[0];

        assert.ok(fn, 'function was uploaded');

        lambda.deleteFunction({ FunctionName: fn.FunctionName }, function(err) {
          if (err) throw err;
          assert.end();
        });
      });
    }
  });
});

test('[deploy] setEventSource', function(assert) {
  process.chdir(example);

  lib.getStackOutputs(stack.stackName, 'us-east-1', function(err, outputs) {
    if (err) throw err;

    lib.deployFunction(
      'us-east-1',
      stack.stackName,
      path.resolve(__dirname, 'fixtures', 'bundle.zip'),
      'index.js',
      outputs.LambdaExecutionRole,
      'test function',
      uploaded
    );

    function uploaded(err) {
      if (err) throw err;

      lib.setEventSource(
        'us-east-1',
        outputs.KinesisStream,
        stack.stackName,
        evented
      );
    }

    function evented(err, uuid) {
      assert.ifError(err, 'set event source');

      var lambda = new AWS.Lambda({ region: 'us-east-1' });
      lambda.getEventSourceMapping({ UUID: uuid }, function(err) {
        assert.ifError(err, 'got event source');

        lambda.deleteFunction({ FunctionName: stack.stackName }, function(err) {
          if (err) throw err;
          assert.end();
        });
      });
    }
  });
});

test('[deploy] deploy', function(assert) {
  process.chdir(example);

  var lambda = new AWS.Lambda({ region: 'us-east-1' });
  var fnName = stack.stackName;
  var environment = stack.stackName.split('-').pop();

  deploy.deploy(
    'test-streambot',
    'index.js',
    environment,
    'us-east-1',
    'description for ' + stack.stackName,
    deployed
  );

  function deployed(err) {
    assert.ifError(err, 'deployed');

    lambda.listFunctions({}, function(err, data) {
      if (err) throw err;

      var fnDescription = data.Functions.filter(function(fn) {
        return fn.FunctionName === fnName;
      })[0];

      assert.ok(fnDescription, 'uploaded function');

      lambda.listEventSourceMappings({
        FunctionName: fnName
      }, function(err, data) {
        assert.ifError(err, 'listed event sources');
        assert.equal(data.EventSourceMappings.length, 1, 'attached event source');

        invoke();
      });
    });
  }

  function invoke() {
    var e = require(path.resolve(__dirname, 'fixtures', 'event.json'));

    lambda.invokeAsync({
      FunctionName: fnName,
      InvokeArgs: new Buffer(JSON.stringify(e))
    }, function(err, data) {
      assert.ifError(err, 'could invoke function');
      assert.equal(data.Status, 202, 'invoked successfully');

      lambda.deleteFunction({ FunctionName: fnName }, function(err) {
        if (err) throw err;
        assert.end();
      });
    });
  }
});

test('[deploy] via npm run', function(assert) {
  process.chdir(example);

  var lambda = new AWS.Lambda({ region: 'us-east-1' });
  var environment = stack.stackName.split('-').pop();

  exec('npm run deploy ' + environment, function(err, stdout, stderr) {
    assert.ifError(err, 'deployed');

    if (err) {
      console.log(stdout);
      console.log(stderr);
    }

    lambda.listFunctions({}, function(err, data) {
      if (err) throw err;

      var fnDescription = data.Functions.filter(function(fn) {
        return fn.FunctionName === stack.stackName;
      })[0];

      assert.ok(fnDescription, 'uploaded function');

      lambda.deleteFunction({ FunctionName: stack.stackName }, function(err) {
        if (err) throw err;
        assert.end();
      });
    });
  });
});

stack.delete();
